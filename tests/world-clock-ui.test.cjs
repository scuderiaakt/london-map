const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
class Elem{
 constructor(id=''){this.id=id;this.children=[];this.dataset={};this.hidden=true;this.attrs={};this.handlers={};this.textContent='';this.classSet=new Set();this.classList={toggle:(key,value)=>{if(value)this.classSet.add(key);else this.classSet.delete(key);},contains:key=>this.classSet.has(key)};}
 append(...children){this.children.push(...children);}
 setAttribute(key,value){this.attrs[key]=value;}
 addEventListener(key,callback){this.handlers[key]=callback;}
 contains(target){return this===target||this.children.some(child=>child.contains(target));}
 focus(){this.focused=true;}
}
test('clock opens by click, closes on Escape/outside, keeps map city and scrolls fixed-width rows',()=>{
 const nodes={};for(const id of ['world-clock-shell','city-clock','world-clock-menu','city-clock-time','city-clock-date'])nodes[id]=new Elem(id);
 nodes['world-clock-shell'].append(nodes['city-clock'],nodes['world-clock-menu']);
 const docEvents={},windowEvents={},timers=[];
 const context={console,Date,Intl,document:{getElementById:id=>nodes[id],createElement:()=>new Elem(),addEventListener:(event,fn)=>docEvents[event]=fn,hidden:false},setInterval:callback=>{timers.push(callback);},currentCityId:'london',matchMedia:()=>({matches:false}),addEventListener:(event,callback)=>windowEvents[event]=callback};context.window=context;vm.createContext(context);
 for(const file of ['world-clock-core.js','world-clock.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
 assert.equal(nodes['world-clock-menu'].hidden,true);
 assert.equal(nodes['world-clock-menu'].children.length,4);
 nodes['city-clock'].handlers.click({stopPropagation(){}});
 assert.equal(nodes['world-clock-menu'].hidden,false);
 assert.equal(nodes['city-clock'].attrs['aria-expanded'],'true');
 assert.match(nodes['world-clock-menu'].children.map(r=>r.children[0].textContent).join(' '),/London Rome İstanbul İzmir/);
 context.currentCityId='rome';timers[0]();assert.match(nodes['city-clock'].attrs['aria-label'],/^Rome /);
 docEvents.keydown({key:'Escape'});assert.equal(nodes['world-clock-menu'].hidden,true);assert.equal(nodes['city-clock'].focused,true);
 nodes['city-clock'].handlers.click({stopPropagation(){}});docEvents.pointerdown({target:new Elem('outside')});assert.equal(nodes['world-clock-menu'].hidden,true);
 const css=fs.readFileSync(path.join(__dirname,'../world-clock.css'),'utf8');assert.match(css,/\.world-clock-menu\{[^}]*width:100%/);assert.match(css,/\.world-clock-menu\{[^}]*overflow-y:auto/);assert.match(css,/#nav2-packs-open\{[^}]*top:calc\(var\(--safe-top\) \+ 55px\)/);
});
