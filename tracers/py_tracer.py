import sys
import io
import json
import types
import builtins

try:
    import resource
except ImportError:
    resource = None

fname = sys.argv[1]
MAX_EVENTS = 1500
MAX_OUT_CHARS = 64000

events = []
steps = []
buf = io.StringIO()
real_stdout = sys.__stdout__
pending_by_frame = {}
last_out_len = 0
prev_locals_snapshot = {}
prev_heap_snapshot = {}
sandbox_active = False

# Stable object identity table: keeps strong references to traced objects so
# Python does not recycle memory addresses into colliding IDs mid-trace.
id_to_oid = {}
oid_keepalive = []
oid_counter = 0

ALLOWED_IMPORTS = {
    'math', 'collections', 'heapq', 'bisect', 'itertools', 'functools',
    'random', 'string', 'json', 're', 'typing', 'dataclasses', 'copy',
    'enum', 'operator', 'statistics', 'fractions', 'decimal', 'array',
    'queue', 'abc', 'numbers', 'pprint', 'time', 'datetime',
}

BLOCKED_AUDIT_PREFIXES = (
    'socket.', 'subprocess.', 'os.system', 'os.popen', 'os.spawn',
    'os.fork', 'os.exec', 'os.kill', 'os.remove', 'os.unlink', 'os.rmdir',
    'os.mkdir', 'os.rename', 'os.chmod', 'os.chown', 'shutil.', 'ctypes.',
    'ftplib.', 'http.client.', 'urllib.', 'smtplib.', 'telnetlib.', 'webbrowser.',
)


def audit_hook(event, args):
    if not sandbox_active:
        return
    for prefix in BLOCKED_AUDIT_PREFIXES:
        if event == prefix.rstrip('.') or event.startswith(prefix):
            raise PermissionError('Blocked restricted operation in sandbox: %s' % event)
    if event == 'open':
        # Block any write/append/create file access or non-readonly open
        mode = str(args[1]) if len(args) > 1 and args[1] is not None else 'r'
        if any(ch in mode for ch in ('w', 'a', 'x', '+')):
            raise PermissionError('File write access is blocked in the Python tracer sandbox.')
        path_arg = str(args[0]) if len(args) > 0 else ''
        if path_arg and not path_arg.startswith('/usr/lib/python') and path_arg != fname:
            raise PermissionError('Filesystem read access is restricted in the Python tracer sandbox.')


def apply_resource_limits():
    if resource is None:
        return
    # CPU time cap (5s soft, 6s hard)
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (5, 6))
    except (ValueError, OSError):
        pass
    # Prevent creating/writing files (0 bytes max file size)
    try:
        resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    except (ValueError, OSError):
        pass
    # Memory cap (256 MB address space)
    try:
        limit = 256 * 1024 * 1024
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        if hard == resource.RLIM_INFINITY or hard >= limit:
            resource.setrlimit(resource.RLIMIT_AS, (limit, limit if hard == resource.RLIM_INFINITY else hard))
    except (ValueError, OSError):
        pass


def get_object_id(obj):
    global oid_counter
    py_id = id(obj)
    oid = id_to_oid.get(py_id)
    if oid is None:
        oid_counter += 1
        oid = 'obj_%d' % oid_counter
        id_to_oid[py_id] = oid
        if len(oid_keepalive) < 4000:
            oid_keepalive.append(obj)
    return oid


def is_visible_var(k, v):
    return (
        not k.startswith('__')
        and not callable(v)
        and not isinstance(v, (type, types.ModuleType))
    )


def serialize_to_heap(v, heap, depth=0):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if v == v and abs(v) != float('inf') else str(v)
    if depth > 8:
        return '…'

    oid = get_object_id(v)
    if oid in heap:
        return {'__ref': oid}

    if isinstance(v, (list, tuple)):
        seq_list = list(v)
        has_complex = any(isinstance(x, (list, tuple, dict, set, frozenset)) or hasattr(x, '__dict__') for x in seq_list[:8])
        cap = 64 if has_complex else 1024
        limit = min(len(seq_list), cap)
        entry = {'id': oid, 'kind': 'array', 'elements': [], 'totalLength': len(seq_list)}
        if len(seq_list) > limit:
            entry['truncated'] = True
        heap[oid] = entry
        entry['elements'] = [serialize_to_heap(x, heap, depth + 1) for x in seq_list[:limit]]
        return {'__ref': oid}

    if isinstance(v, (set, frozenset)):
        seq_list = list(v)
        limit = min(len(seq_list), 256)
        entry = {'id': oid, 'kind': 'set', 'elements': [], 'totalLength': len(seq_list)}
        if len(seq_list) > limit:
            entry['truncated'] = True
        heap[oid] = entry
        entry['elements'] = [serialize_to_heap(x, heap, depth + 1) for x in seq_list[:limit]]
        return {'__ref': oid}

    if isinstance(v, dict):
        items = list(v.items())
        limit = min(len(items), 64)
        entry = {'id': oid, 'kind': 'object', 'entries': {}}
        if len(items) > limit:
            entry['truncated'] = True
        heap[oid] = entry
        for k, x in items[:limit]:
            entry['entries'][str(k)] = serialize_to_heap(x, heap, depth + 1)
        return {'__ref': oid}

    if hasattr(v, '__dict__'):
        cls_name = type(v).__name__
        items = list(vars(v).items())
        entry = {'id': oid, 'kind': 'object', 'className': cls_name, 'entries': {}}
        heap[oid] = entry
        for k, x in items[:48]:
            if not k.startswith('__') and not callable(x):
                entry['entries'][k] = serialize_to_heap(x, heap, depth + 1)
        return {'__ref': oid}

    return repr(v)


def is_ref_or_none(val, heap):
    if val is None:
        return True
    if isinstance(val, dict) and '__ref' in val and len(val) == 1:
        target = heap.get(val['__ref'])
        return target is not None and target.get('kind') == 'object'
    return False


def materialize_plain(ref, heap, depth=0, visiting=None):
    visiting = set() if visiting is None else visiting
    if not (isinstance(ref, dict) and '__ref' in ref and len(ref) == 1):
        return ref
    oid = ref['__ref']
    obj = heap.get(oid)
    if obj is None:
        return None
    if oid in visiting:
        return '↺(%s)' % oid
    if depth > 8:
        return '…'
    visiting.add(oid)
    try:
        if obj['kind'] in ('array', 'set'):
            return [materialize_plain(el, heap, depth + 1, visiting) for el in obj.get('elements', [])]
        out = {}
        cls_name = obj.get('className')
        if cls_name and cls_name not in ('Object', 'dict'):
            out['__cls'] = cls_name
        for k, v in obj.get('entries', {}).items():
            out[k] = materialize_plain(v, heap, depth + 1, visiting)
        return out
    finally:
        visiting.discard(oid)


def build_call_stack(frame, return_val=None, is_return=False):
    frames = []
    curr = frame
    while curr is not None:
        if curr.f_code.co_filename == fname:
            fn_name = 'main' if curr.f_code.co_name == '<module>' else curr.f_code.co_name
            vis_locals = {k: v for k, v in curr.f_locals.items() if is_visible_var(k, v)}
            f_entry = {
                'frameId': 'py-frame-%d' % id(curr),
                'name': fn_name,
                'line': max(1, min(int(curr.f_lineno or 1), total_source_lines)),
                'localsCount': len(vis_locals),
            }
            if curr is frame and is_return:
                f_entry['returnValue'] = repr(return_val) if return_val is not None else None
            frames.append(f_entry)
        curr = curr.f_back
    frames.reverse()
    return frames


def classify_event_and_changes(locals_map, heap, delta_out, forced_type=None, fn_name='main', return_val=None, error_msg=None):
    changes = []
    event_type = forced_type or 'statement'
    provenance = 'observed'
    extra_meta = {}

    # Compare top-level variable bindings
    for k, ref in locals_map.items():
        if k not in prev_locals_snapshot:
            changes.append({'target': k, 'kind': 'create', 'newValue': ref})
            if forced_type is None:
                if isinstance(ref, dict) and '__ref' in ref:
                    obj = heap.get(ref['__ref'])
                    if obj and obj['kind'] == 'array':
                        event_type = 'array_create'
                    else:
                        event_type = 'object_create'
                else:
                    event_type = 'var_declare'
        elif prev_locals_snapshot[k] != ref:
            changes.append({'target': k, 'kind': 'update', 'oldValue': prev_locals_snapshot[k], 'newValue': ref})
            if forced_type is None:
                event_type = 'var_assign'

    # Compare heap objects for array / property mutations
    for oid, obj in heap.items():
        prev_obj = prev_heap_snapshot.get(oid)
        if prev_obj is None:
            continue
        if obj['kind'] == 'array' and prev_obj.get('kind') == 'array':
            old_els = prev_obj.get('elements', [])
            new_els = obj.get('elements', [])
            if old_els != new_els:
                if len(new_els) == len(old_els) + 1 and new_els[:-1] == old_els:
                    changes.append({
                        'target': oid,
                        'objectId': oid,
                        'kind': 'create',
                        'index': len(new_els) - 1,
                        'newValue': new_els[-1],
                    })
                    if forced_type is None:
                        event_type = 'array_append'
                        extra_meta['arrayOp'] = 'push'
                elif len(new_els) == len(old_els) - 1 and old_els[:-1] == new_els:
                    changes.append({
                        'target': oid,
                        'objectId': oid,
                        'kind': 'delete',
                        'index': len(old_els) - 1,
                        'oldValue': old_els[-1],
                    })
                    if forced_type is None:
                        event_type = 'array_remove'
                        extra_meta['arrayOp'] = 'pop'
                elif len(new_els) == len(old_els) - 1 and old_els[1:] == new_els:
                    changes.append({
                        'target': oid,
                        'objectId': oid,
                        'kind': 'delete',
                        'index': 0,
                        'oldValue': old_els[0],
                    })
                    if forced_type is None:
                        event_type = 'array_remove'
                        extra_meta['arrayOp'] = 'shift'
                elif len(new_els) == len(old_els) + 1 and new_els[1:] == old_els:
                    changes.append({
                        'target': oid,
                        'objectId': oid,
                        'kind': 'create',
                        'index': 0,
                        'newValue': new_els[0],
                    })
                    if forced_type is None:
                        event_type = 'array_insert'
                        extra_meta['arrayOp'] = 'unshift'
                elif len(new_els) != len(old_els):
                    changes.append({
                        'target': oid,
                        'objectId': oid,
                        'kind': 'update',
                        'oldValue': len(old_els),
                        'newValue': len(new_els),
                    })
                    if forced_type is None:
                        event_type = 'array_insert' if len(new_els) > len(old_els) else 'array_remove'
                        provenance = 'inferred'
                else:
                    diffs = [idx for idx in range(len(new_els)) if old_els[idx] != new_els[idx]]
                    if len(diffs) == 2 and old_els[diffs[0]] == new_els[diffs[1]] and old_els[diffs[1]] == new_els[diffs[0]]:
                        changes.append({
                            'target': oid,
                            'objectId': oid,
                            'kind': 'update',
                            'index': diffs[0],
                            'oldValue': old_els[diffs[0]],
                            'newValue': new_els[diffs[0]],
                        })
                        changes.append({
                            'target': oid,
                            'objectId': oid,
                            'kind': 'update',
                            'index': diffs[1],
                            'oldValue': old_els[diffs[1]],
                            'newValue': new_els[diffs[1]],
                        })
                        if forced_type is None:
                            event_type = 'array_swap'
                            provenance = 'inferred'
                    else:
                        for idx in diffs[:6]:
                            changes.append({
                                'target': oid,
                                'objectId': oid,
                                'kind': 'update',
                                'index': idx,
                                'oldValue': old_els[idx],
                                'newValue': new_els[idx],
                            })
                        if forced_type is None:
                            event_type = 'array_update'
        elif obj['kind'] == 'object' and prev_obj.get('kind') == 'object':
            old_ent = prev_obj.get('entries', {})
            new_ent = obj.get('entries', {})
            for prop, val in new_ent.items():
                if prop not in old_ent or old_ent[prop] != val:
                    old_val = old_ent.get(prop)
                    changes.append({
                        'target': oid,
                        'objectId': oid,
                        'property': prop,
                        'kind': 'create' if prop not in old_ent else 'update',
                        'oldValue': old_val,
                        'newValue': val,
                    })
                    if forced_type is None:
                        is_ptr = is_ref_or_none(val, heap) and (prop not in old_ent or is_ref_or_none(old_val, prev_heap_snapshot))
                        if prop in ('next', 'prev', 'left', 'right', 'parent') and is_ptr:
                            event_type = 'reference_update'
                        else:
                            event_type = 'property_set'
            for prop in old_ent:
                if prop not in new_ent:
                    changes.append({
                        'target': oid,
                        'objectId': oid,
                        'property': prop,
                        'kind': 'delete',
                        'oldValue': old_ent[prop],
                    })
                    if forced_type is None:
                        event_type = 'property_delete'

    unreachable = [oid for oid in prev_heap_snapshot.keys() if oid not in heap]
    if unreachable:
        extra_meta['unreachableObjectIds'] = unreachable

    if delta_out and forced_type is None and not changes:
        event_type = 'console_output'
        changes.append({'target': 'stdout', 'kind': 'output', 'newValue': delta_out.rstrip('\n')})

    if forced_type == 'function_call':
        changes.insert(0, {'target': fn_name, 'kind': 'call'})
    elif forced_type == 'function_return':
        changes.insert(0, {'target': fn_name, 'kind': 'return', 'newValue': repr(return_val) if return_val is not None else None})
    elif forced_type == 'error':
        changes.insert(0, {'target': 'exception', 'kind': 'error', 'newValue': error_msg or 'Exception'})

    return event_type, provenance, changes, extra_meta


def emit_event(frame, line_no, forced_type=None, return_val=None, error_msg=None, extra_metadata=None, allow_overflow=False):
    global last_out_len, prev_locals_snapshot, prev_heap_snapshot
    if not allow_overflow and len(events) >= MAX_EVENTS:
        raise RuntimeError('Step limit (%d) reached (possible infinite loop).' % MAX_EVENTS)

    g = frame.f_globals
    d = {k: v for k, v in g.items() if is_visible_var(k, v)}
    if frame.f_locals is not g:
        d.update({k: v for k, v in frame.f_locals.items() if is_visible_var(k, v)})

    heap = {}
    locals_map = {}
    for k, v in d.items():
        locals_map[k] = serialize_to_heap(v, heap)

    full_out = buf.getvalue()
    if len(full_out) > MAX_OUT_CHARS:
        raise RuntimeError('Console output limit (%d chars) reached.' % MAX_OUT_CHARS)
    delta = full_out[last_out_len:]
    last_out_len = len(full_out)
    printed = delta.rstrip('\n') if delta else ''

    fn_name = 'main' if frame.f_code.co_name == '<module>' else frame.f_code.co_name
    event_type, provenance, changes, diff_meta = classify_event_and_changes(
        locals_map, heap, delta, forced_type=forced_type, fn_name=fn_name, return_val=return_val, error_msg=error_msg
    )

    seq = len(events) + 1
    call_stack = build_call_stack(frame, return_val=return_val, is_return=(forced_type == 'function_return'))
    clean_line = max(1, min(int(line_no or 1), total_source_lines))

    meta = {'runtime': 'python3'}
    meta.update(diff_meta)
    if extra_metadata:
        meta.update(extra_metadata)

    explanation = ''
    if forced_type == 'error' and error_msg:
        explanation = 'Exception raised: %s' % error_msg

    ev = {
        'id': 'event-%03d' % seq,
        'sequence': seq,
        'line': clean_line,
        'type': event_type,
        'provenance': provenance,
        'scope': fn_name,
        'functionName': fn_name,
        'changes': changes,
        'objectIds': list(heap.keys()),
        'heap': heap,
        'locals': locals_map,
        'callStack': call_stack,
        'print': printed,
        'outText': full_out[-4000:],
        'explanation': explanation,
        'metadata': meta,
        'scene': None,
    }
    events.append(ev)

    plain_vars = {k: materialize_plain(ref, heap) for k, ref in locals_map.items()}
    steps.append({
        'line': clean_line,
        'note': explanation,
        'vars': plain_vars,
        'print': printed,
        'scene': None,
        'outText': full_out[-4000:],
    })

    prev_locals_snapshot = dict(locals_map)
    prev_heap_snapshot = heap


seen_exception_ids = set()
total_source_lines = 1


def local_trace(frame, event, arg):
    fid = id(frame)
    if event == 'line':
        prev_line = pending_by_frame.get(fid)
        if prev_line is not None:
            emit_event(frame, prev_line)
        pending_by_frame[fid] = frame.f_lineno
    elif event == 'return':
        prev_line = pending_by_frame.pop(fid, None)
        is_user_fn = frame.f_code.co_name != '<module>'
        if prev_line is not None:
            emit_event(
                frame,
                prev_line,
                forced_type='function_return' if is_user_fn else None,
                return_val=arg if is_user_fn else None,
            )
    elif event == 'exception':
        pending_by_frame.pop(fid, None)
        exc_type, exc_val, _ = arg
        exc_id = id(exc_val)
        if exc_id not in seen_exception_ids:
            seen_exception_ids.add(exc_id)
            err_msg = '%s: %s' % (exc_type.__name__, exc_val)
            emit_event(
                frame,
                frame.f_lineno,
                forced_type='error',
                error_msg=err_msg,
                extra_metadata={'thrown': True, 'error': err_msg},
                allow_overflow=True,
            )
    return local_trace


def global_trace(frame, event, arg):
    if frame.f_code.co_filename == fname:
        if event == 'call' and frame.f_code.co_name != '<module>':
            emit_event(frame, frame.f_lineno, forced_type='function_call')
        return local_trace
    return None


def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    root = name.split('.')[0]
    if root not in ALLOWED_IMPORTS:
        raise ImportError('Module "%s" is blocked in the Python tracer sandbox.' % name)
    return builtins.__import__(name, globals, locals, fromlist, level)


def safe_input(prompt=''):
    if prompt:
        buf.write(str(prompt))
    line = sys.stdin.readline()
    if line == '':
        raise EOFError(
            'Program asked for input, but Program Input has no more lines. Add the values in Program Input and try again.'
        )
    return line.rstrip('\r\n')


def build_safe_builtins():
    safe = dict(vars(builtins))
    for banned in ('open', 'exec', 'eval', 'compile', 'breakpoint', 'exit', 'quit'):
        safe.pop(banned, None)
    safe['input'] = safe_input
    safe['__import__'] = safe_import
    return safe


user_stdin = ''
user_args = []
if len(sys.argv) > 2 and sys.argv[2]:
    try:
        with open(sys.argv[2], encoding='utf-8') as cfg_f:
            cfg = json.load(cfg_f)
            if isinstance(cfg, dict):
                if isinstance(cfg.get('stdin'), str):
                    user_stdin = cfg['stdin']
                if isinstance(cfg.get('args'), list):
                    user_args = [str(a) for a in cfg['args'][:32]]
    except Exception:
        pass

err = ''
try:
    with open(fname, encoding='utf-8') as f:
        source = f.read()
    total_source_lines = max(1, len(source.splitlines()))
    code = compile(source, fname, 'exec')
    apply_resource_limits()
    sys.addaudithook(audit_hook)
    sys.stdout = buf
    sys.stdin = io.StringIO(user_stdin)
    sys.argv = [fname] + user_args
    sandbox_active = True
    sys.settrace(global_trace)
    exec(code, {'__name__': '__main__', '__builtins__': build_safe_builtins()})
except BaseException as e:
    err = '%s: %s' % (type(e).__name__, e)
    if events and events[-1].get('type') == 'error':
        events[-1]['metadata']['uncaught'] = True
finally:
    sys.settrace(None)
    sandbox_active = False
    sys.stdout = real_stdout

json.dump({'schemaVersion': '2.0', 'events': events, 'steps': steps, 'error': err, 'interrupted': bool(err)}, real_stdout, default=str)
