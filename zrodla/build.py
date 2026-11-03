"""Składa dist/index.html z szablonu src/app.html i dist/exercises.json."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, 'src', 'app.html'), encoding='utf-8').read()

def inject_anim(tpl):
    """Wkleja silnik animacji ćwiczeń (src/anim.js, src/anim_ex.js) i jego style (src/anim.css)."""
    src = os.path.join(HERE, 'src')
    css = open(os.path.join(src, 'anim.css'), encoding='utf-8').read()
    js = open(os.path.join(src, 'anim.js'), encoding='utf-8').read() + '\n' + open(os.path.join(src, 'anim_ex.js'), encoding='utf-8').read() + '\n' + open(os.path.join(src, 'muscles.js'), encoding='utf-8').read() + '\n' + open(os.path.join(src, 'anim_body.js'), encoding='utf-8').read()
    assert tpl.count('/*__ANIM_CSS__*/') == 1 and tpl.count('/*__ANIM_JS__*/') == 1
    return tpl.replace('/*__ANIM_CSS__*/', css).replace('/*__ANIM_JS__*/', js.replace('</script', '<\\/script'))
tpl = inject_anim(tpl)
data = json.load(open(os.path.join(HERE, 'dist', 'exercises.json'), encoding='utf-8'))
js = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
assert tpl.count('__EXERCISES_JSON__') == 1
open(os.path.join(HERE, 'dist', 'index.html'), 'w', encoding='utf-8').write(tpl.replace('__EXERCISES_JSON__', js))
print('index.html', os.path.getsize(os.path.join(HERE, 'dist', 'index.html')), 'B')
