import asyncio, json
from playwright.async_api import async_playwright
B = json.load(open('/tmp/mm/body2.json'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page()
        await pg.set_content('<html><body style="margin:0;background:#fff"><svg id=s xmlns="http://www.w3.org/2000/svg"></svg></body></html>')
        await pg.evaluate('''(B) => { window.draw = (view, vb, W, H, step) => {
            const s = document.getElementById('s'); s.setAttribute('viewBox', vb); s.setAttribute('width', W); s.setAttribute('height', H);
            const [x0,y0,w,h] = vb.split(' ').map(Number);
            let out = `<path d="${B.outline[view]}" fill="#f4f4f4" stroke="#999"/>`;
            B[view].forEach(([r, d]) => { out += `<path d="${d}" fill="${r.startsWith('skin')?'#ddd':(r==='delts'?'#e88':r==='chest'?'#8ae':r==='traps'?'#9d9':'#555')}"/>`; });
            for (let x = Math.ceil(x0/step)*step; x < x0+w; x += step) out += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0+h}" stroke="#00f" stroke-width=".5"/><text x="${x+1}" y="${y0+8}" font-size="7" fill="#00f">${x}</text>`;
            for (let y = Math.ceil(y0/step)*step; y < y0+h; y += step) out += `<line x1="${x0}" y1="${y}" x2="${x0+w}" y2="${y}" stroke="#00f" stroke-width=".5"/><text x="${x0+1}" y="${y-1}" font-size="7" fill="#00f">${y}</text>`;
            s.innerHTML = out; }; }''', B)
        for view, vb, name in [('front', '180 290 200 160', 'c_front'), ('back', '900 290 200 200', 'c_back')]:
            x, y, w, h = map(float, vb.split()); W = 900; H = int(W*h/w)
            await pg.set_viewport_size({'width': W, 'height': H})
            await pg.evaluate(f'draw("{view}", "{vb}", {W}, {H}, 10)')
            await pg.screenshot(path=f'/tmp/mm/{name}.png')
        await b.close()
asyncio.run(main())
