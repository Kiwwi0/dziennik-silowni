import asyncio, json
from playwright.async_api import async_playwright
B = json.load(open('/tmp/mm/body2.json'))
PAL = ['#e6194b','#3cb44b','#4363d8','#f58231','#911eb4','#42d4f4','#f032e6','#bfef45','#fabed4','#469990','#dcbeff','#9A6324','#800000','#aaffc3','#808000','#000075']
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width': 1300, 'height': 1300})
        html = '<html><body style="margin:0;background:#fff"><svg id=s xmlns="http://www.w3.org/2000/svg"></svg></body></html>'
        await pg.set_content(html)
        await pg.evaluate('''([B, PAL]) => {
          window.draw = (view, vb, w, h) => {
            const s = document.getElementById('s'); s.setAttribute('viewBox', vb); s.setAttribute('width', w); s.setAttribute('height', h);
            let out = `<path d="${B.outline[view]}" fill="#f4f4f4" stroke="#999"/>`; const labels = [];
            B[view].forEach(([r, d, side], i) => { if (r.startsWith('skin')) { out += `<path d="${d}" fill="#ddd"/>`; return; }
              out += `<path id="p${i}" d="${d}" fill="${PAL[i % PAL.length]}" fill-opacity=".85"/>`; labels.push(i); });
            s.innerHTML = out;
            for (const i of labels){ const bb = document.getElementById('p'+i).getBBox();
              const t = document.createElementNS('http://www.w3.org/2000/svg','text'); t.setAttribute('x', bb.x + bb.width/2); t.setAttribute('y', bb.y + bb.height/2);
              t.setAttribute('font-size', '11'); t.setAttribute('text-anchor', 'middle'); t.setAttribute('font-family', 'sans-serif'); t.setAttribute('font-weight', '700');
              t.setAttribute('stroke', '#fff'); t.setAttribute('stroke-width', '3'); t.setAttribute('paint-order', 'stroke'); t.textContent = i; s.appendChild(t); }
          };
        }''', [B, PAL])
        # front upper / lower, back upper / lower: zoom on left half of body (person's right) to keep labels readable
        jobs = [('front', '120 260 380 420', 'f_up'), ('front', '190 650 330 700', 'f_lo'), ('back', '830 280 400 420', 'b_up'), ('back', '900 600 330 700', 'b_lo')]
        for view, vb, name in jobs:
            x, y, w, h = map(float, vb.split()); W = 1100; H = int(W * h / w)
            await pg.set_viewport_size({'width': W, 'height': H})
            await pg.evaluate(f'draw("{view}", "{vb}", {W}, {H})')
            await pg.screenshot(path=f'/tmp/mm/{name}.png')
        await b.close()
asyncio.run(main())
