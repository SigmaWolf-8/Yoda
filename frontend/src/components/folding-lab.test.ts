// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const source=readFileSync('public/capomastro/docs/salvi-isopsephy-engine-v0.0.20.html','utf8');
const adapter=readFileSync('public/capomastro/adapters/folding-lab.js','utf8');
const prefix=source.slice(source.indexOf('const MILESIAN'),source.indexOf('function factorize'));
const gcd=source.slice(source.indexOf('function gcd('),source.indexOf('// Initialize drag drop'));
const input=()=>document.querySelector<HTMLTextAreaElement>('#foldingText')!;
const status=()=>document.getElementById('foldingInputStatus')!.textContent!;
function derive(){ (window as unknown as {deriveUnity:()=>void}).deriveUnity(); }
function clear(){ (window as unknown as {clearDropZone:()=>void}).clearDropZone(); }
function transferEvent(type:string,text:string) {
  const event=new Event(type,{bubbles:true,cancelable:true});
  Object.defineProperty(event,type==='paste'?'clipboardData':'dataTransfer',{value:{files:[],getData:()=>text}});
  return event;
}
describe('functional folding adapter with the sealed engine mappings',()=>{
  beforeEach(()=>{
    document.body.innerHTML='<span class="draggable" data-symbol="δ"></span><div id="dropZone"></div><div id="foldingResults"><div id="foldingOutput"></div></div>';
    window.eval(prefix+'\n'+gcd);
    window.eval(adapter);
  });
  afterEach(()=>{clear();vi.restoreAllMocks();});
  it('pastes into the actual box and derives exact finite values',()=>{
    input().dispatchEvent(transferEvent('paste','δ θ'));
    expect(input().value).toBe('δ θ');
    derive();
    expect(document.getElementById('foldingSummary')!.textContent).toContain('Sum = 13; sum modulo 364 = 13; digital root = 4; common divisor = 1');
  });
  it('accepts dropped text and original-engine Latin transliteration',()=>{
    document.getElementById('dropZone')!.dispatchEvent(transferEvent('drop','Capomastro'));
    derive();
    expect(document.getElementById('foldingSummary')!.textContent).toContain('Sum = 882');
  });
  it('supports keyboard primitives and clears input/results',()=>{
    document.querySelector('.draggable')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    expect(input().value).toBe('δ');
    derive(); clear();
    expect(input().value).toBe('');
    expect(document.getElementById('foldingResults')!.style.display).toBe('none');
  });
  it('does not invent values for unknown characters',()=>{
    input().value='中文';
    derive();
    expect(status()).toContain('not assigned a fabricated value');
    expect(document.getElementById('foldingResults')!.style.display).toBe('none');
  });
  it('preserves framework lambda versus ordinary Greek lambda',()=>{
    input().value='Λ λ';
    derive();
    expect(document.getElementById('foldingSummary')!.textContent).toContain('Sum = 121');
  });
  it('never renders pasted markup as executable HTML',()=>{
    input().dispatchEvent(transferEvent('paste','δ <img src=x onerror=alert(1)>'));
    derive();
    expect(document.querySelector('#foldingOutput img')).toBeNull();
  });
  it('invalidates old results after editing',()=>{
    input().value='δ';derive();
    input().value='θ';input().dispatchEvent(new Event('input',{bubbles:true}));
    expect(document.getElementById('foldingResults')!.style.display).toBe('none');
  });
  it('rejects oversized pasted text without replacing existing input',()=>{
    input().value='δ';
    input().dispatchEvent(transferEvent('paste','a'.repeat(100001)));
    expect(input().value).toBe('δ');
    expect(status()).toContain('exceed 100,000');
  });
  it('reads a dropped document through the extraction bridge and derives its returned text',async()=>{
    const send=vi.spyOn(window,'postMessage').mockImplementation(()=>{});
    const event=new Event('drop',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'dataTransfer',{value:{files:[{
      name:'example.txt',size:5,arrayBuffer:async()=>new TextEncoder().encode('δ θ').buffer,
    }]}});
    document.getElementById('dropZone')!.dispatchEvent(event);
    await vi.waitFor(()=>expect(send).toHaveBeenCalled());
    const request=send.mock.calls[0][0] as {id:string;type:string;format:string};
    expect(request.type).toBe('folding:extract');
    expect(request.format).toBe('txt');
    window.dispatchEvent(new MessageEvent('message',{source:window,data:{
      type:'folding:extracted',id:request.id,text:'δ θ',limitations:['Text only.'],
    }}));
    await vi.waitFor(()=>expect(input().value).toBe('δ θ'));
    derive();
    expect(document.getElementById('foldingSummary')!.textContent).toContain('Sum = 13');
  });
  it('Clear cancels a file still being read before any extraction request',async()=>{
    const send=vi.spyOn(window,'postMessage').mockImplementation(()=>{});
    let resolve!:(bytes:ArrayBuffer)=>void;
    const bytes=new Promise<ArrayBuffer>(done=>{resolve=done;});
    const event=new Event('drop',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'dataTransfer',{value:{files:[{name:'example.txt',size:1,arrayBuffer:()=>bytes}]}});
    document.getElementById('dropZone')!.dispatchEvent(event);
    clear();
    resolve(new ArrayBuffer(1));
    await bytes;
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    expect(input().value).toBe('');
  });
});
