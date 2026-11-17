// Local-only throwaway Focus prototype. This command never runs the real API.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (process.env.NODE_ENV === 'production') throw new Error('The set prototype is local-only.');
const source = fileURLToPath(new URL('../src/client/prototypes/per-set-slots.html', import.meta.url));
const server = createServer(async (_request, response) => {
  const fragment = await readFile(source, 'utf8');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FORM set targets — prototype</title><style>
    body{margin:0;padding:10px 12px 90px;background:#202833;color:#edf3f9;font:14px/1.5 system-ui,sans-serif}*{box-sizing:border-box}[hidden]{display:none!important}.prototype-switcher{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:10;display:flex;gap:12px;align-items:center;background:#edf3f9;color:#10151c;border-radius:30px;box-shadow:0 5px 25px #0006;padding:8px 12px;white-space:nowrap}.prototype-switcher button{border:0;background:transparent;color:inherit;font-size:20px;min-width:36px;min-height:36px}.prototype-switcher span{font-size:12px;min-width:130px;text-align:center}
  </style></head><body>${fragment}<nav class="prototype-switcher" aria-label="Prototype layout variants"><button id="proto-previous" aria-label="Previous layout">←</button><span id="proto-name"></span><button id="proto-next" aria-label="Next layout">→</button></nav><script>
    const variants=[...document.querySelectorAll('#workout-set-slots > [data-layout]')];
    const query=new URLSearchParams(location.search);
    let index=Math.max(0,variants.findIndex(v=>v.dataset.layout===query.get('variant')));
    function show(){variants.forEach((v,i)=>v.hidden=i!==index);document.getElementById('proto-name').textContent=variants[index].dataset.variant;const url=new URL(location);url.searchParams.set('variant',variants[index].dataset.layout);history.replaceState({},'',url);}
    function move(delta){index=(index+delta+variants.length)%variants.length;show();}
    document.getElementById('proto-previous').onclick=()=>move(-1);document.getElementById('proto-next').onclick=()=>move(1);
    document.addEventListener('keydown',event=>{if(event.target.closest('input,textarea,select,[contenteditable]'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowRight'?1:-1);}});show();
  </script></body></html>`);
});
const port = Number(process.env.PORT || 3001);
server.listen(port, '127.0.0.1', () => console.log(`Throwaway set prototype: http://localhost:${port}/?variant=ledger (also focus, compare)`));
