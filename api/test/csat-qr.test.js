const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const jsqr = require('jsqr');
const qrSource = fs.readFileSync(require.resolve('../../app/vendor/qrcode.js'),'utf8');
const uiSource = fs.readFileSync(require.resolve('../../app/csat-share.js'),'utf8');
test('locally packaged QR decodes to the exact fragment-bearing URL',()=>{
  let canvas;
  function node(tag) {
    const el={tag,children:[],setAttribute(){},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];}};
    if(tag==='canvas') { canvas=el; el.getContext=()=>({fillStyle:'#fff',fillRect(x,y,w,h){const dark=this.fillStyle==='#000'; el.pixels ||= new Uint8ClampedArray(el.width*el.height*4); for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){const offset=(row*el.width+col)*4; el.pixels[offset]=el.pixels[offset+1]=el.pixels[offset+2]=dark?0:255; el.pixels[offset+3]=255;}}}); }
    return el;
  }
  const context={window:{},document:{createElement:node},location:{origin:'https://training.example',hostname:'training.example'},URL,navigator:{},console};
  vm.runInNewContext(qrSource,context); context.window.qrcode=context.qrcode;
  vm.runInNewContext(uiSource,context);
  const link='/csat/#s.session-1.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO12';
  context.window.CsatShare.mount(node('div'),{link,state:'open'});
  assert.ok(canvas?.pixels);
  const decoded=jsqr(canvas.pixels,canvas.width,canvas.height);
  assert.equal(decoded.data,'https://training.example'+link);
  assert.equal(qrSource,fs.readFileSync(require.resolve('qrcode-generator'),'utf8'));
});
