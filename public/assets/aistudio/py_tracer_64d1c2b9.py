import sys, io, json, types
fname = sys.argv[1]
MAX = 1500
steps = []
buf = io.StringIO()
real = sys.__stdout__

def ser(v, d=0, seen=None):
    seen = set() if seen is None else seen
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return v if v == v and abs(v) != float('inf') else str(v)
    if id(v) in seen: return '↺'
    if d > 7: return '…'
    seen.add(id(v))
    try:
        if isinstance(v, (list, tuple, set, frozenset)):
            return [ser(x, d + 1, seen) for x in list(v)[:40]]
        if isinstance(v, dict):
            return {str(k): ser(x, d + 1, seen) for k, x in list(v.items())[:20]}
        if hasattr(v, '__dict__'):
            r = {'__cls': type(v).__name__}
            for k, x in list(vars(v).items())[:20]: r[k] = ser(x, d + 1, seen)
            return r
        return repr(v)
    finally:
        seen.discard(id(v))

def ok(k, v):
    return not k.startswith('__') and not callable(v) and not isinstance(v, (type, types.ModuleType))

def snap(frame):
    if len(steps) >= MAX: raise RuntimeError('Step limit (%d) reached' % MAX)
    g = frame.f_globals
    d = {k: v for k, v in g.items() if ok(k, v)}
    if frame.f_locals is not g:
        d.update({k: v for k, v in frame.f_locals.items() if ok(k, v)})
    steps.append({'line': frame.f_lineno, 'vars': {k: ser(v) for k, v in d.items()}, 'outText': buf.getvalue()[-4000:]})

def local(frame, event, arg):
    if event == 'line': snap(frame)
    return local

def glob(frame, event, arg):
    return local if frame.f_code.co_filename == fname else None

err = ''
try:
    code = compile(open(fname, encoding='utf-8').read(), fname, 'exec')
    sys.stdout = buf
    sys.stdin = io.StringIO('')
    sys.settrace(glob)
    exec(code, {'__name__': '__main__'})
except BaseException as e:
    err = '%s: %s' % (type(e).__name__, e)
finally:
    sys.settrace(None)
    sys.stdout = real
json.dump({'steps': steps, 'error': err}, real, default=str)
