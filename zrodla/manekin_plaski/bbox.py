import asyncio, json
from playwright.async_api import async_playwright
B = json.load(open('/tmp/mm/body.json'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = await b.new_page()
        await pg.set_content('<svg id=s xmlns="http://www.w3.org/2000/svg" width="1448" height="1448"></svg>')
        res = await pg.evaluate('''(B) => { const s = document.getElementById('s'); const out = {};
          for (const v of ['front','back']) for (const part of B[v]) for (const side of ['left','right','common']) part[side].forEach((d,i) => {
            const p = document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('d', d); s.appendChild(p);
            const bb = p.getBBox(); out[v+':'+part.slug+':'+side+':'+i] = [Math.round(bb.x), Math.round(bb.y), Math.round(bb.width), Math.round(bb.height)]; });
          return out; }''', B)
        json.dump(res, open('/tmp/mm/bbox.json','w'))
        for k, v in res.items():
            if any(x in k for x in ['upper-back','lower-back','trapezius','deltoids','triceps:left','gluteal','hamstring:left','calves:left','obliques:left:0','forearm:left']): print(k, v)
        await b.close()
asyncio.run(main())
