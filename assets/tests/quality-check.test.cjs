/* Deterministic layout fixtures: no browser, network, or editor dependencies.
   These mocks supply measured DOM geometry; visual/browser acceptance is separate. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {runInNewContext}=require('node:vm');
const source=readFileSync(join(__dirname,'../quality-check.js'),'utf8');

function node(x,y,w,h,options={}){
  const item={
    offsetLeft:x,offsetTop:y,offsetWidth:w,offsetHeight:h,
    ...options,
    matches(selector){
      return (selector.includes('.zone')&&this.zone)||
        (selector.includes('[data-fig-decoration]')&&this.decoration)||
        (selector.includes('[data-fig-role="background"]')&&this.role==='background');
    },
    closest(selector){
      if(selector==='[data-fig-ui]') return this.ui?this:null;
      if(selector==='.fig-elabel') return this.label?this:null;
      return null;
    },
    getClientRects(){ return this.hidden?[]:[{}]; }
  };
  item.texts=options.text===false?[]:[{textContent:options.text||'Device',parentElement:item}];
  return item;
}
function edge(x0,y0,x1,y1,ctrl){
  return {_geom:{p0:{x:x0,y:y0},p1:{x:x1,y:y1},ctrl:ctrl||{x:(x0+x1)/2,y:(y0+y1)/2}}};
}
function canvas(w=400,h=240,nodes=compact(),edges=[],profile='network'){
  return {
    offsetWidth:w,offsetHeight:h,dataset:profile?{figQuality:profile}:{},
    getBoundingClientRect(){ return {width:w}; },
    querySelectorAll(selector){ return selector==='.fig-node'?nodes:edges; },
    texts:nodes.filter(n=>n.text!==false).map(n=>({textContent:n.text||'Device',parentElement:n}))
  };
}
function compact(){
  return [node(40,40,120,60),node(240,40,120,60),node(40,140,120,60),node(240,140,120,60)];
}
function check(canvases){
  return JSON.parse(runInNewContext(source,{
    document:{
      querySelectorAll(){ return canvases; },
      createTreeWalker(cv){
        let index=0;
        return {nextNode(){ this.currentNode=cv.texts[index++]; return !!this.currentNode; }};
      },
      createRange(){
        return {
          selectNodeContents(text){this.text=text;},
          getClientRects(){
            const n=this.text.parentElement;
            const width=n.textWidth??Math.min(this.text.textContent.length*7,n.offsetWidth-16);
            const height=n.textHeight??14;
            return [{left:n.offsetLeft+8,top:n.offsetTop+6,
              right:n.offsetLeft+8+width,bottom:n.offsetTop+6+height}];
          }
        };
      }
    },
    NodeFilter:{SHOW_TEXT:4},
    getComputedStyle(el){ return {fontSize:String(el.font||14)+'px',display:'block',visibility:'visible',
      paddingLeft:'8px',paddingRight:'8px',paddingTop:'6px',paddingBottom:'6px'}; }
  }));
}
function result(cv){ return check([cv]).canvases[0]; }

test('compact linked network passes with content-only occupancy',()=>{
  const c=result(canvas(400,240,compact(),[edge(160,70,240,70),edge(160,170,240,170)]));
  assert.equal(c.ok,true);
  assert.equal(c.nodes,4);
  assert.equal(c.edges,2);
  assert.equal(c.renderedEdges,2);
  assert.ok(c.nodeFill>=8&&c.fill>=20&&c.largestBlank<=35);
});
for(const marker of [{zone:true},{decoration:true},{role:'background'}]){
  test('full-canvas background cannot make tiny sparse nodes pass: '+JSON.stringify(marker),()=>{
    const nodes=[node(0,0,4672,1789,marker),node(40,40,80,40),node(4500,1600,80,40)];
    const c=result(canvas(4672,1789,nodes));
    assert.equal(c.ok,false);
    assert.equal(c.excludedNodes,1);
    assert.equal(c.nodes,2);
    assert.ok(c.fill<2);
    assert.ok(c.reasons.includes('low_node_fill'));
    assert.ok(c.reasons.includes('large_blank_rectangle'));
    assert.ok(c.reasons.includes('extreme_canvas_aspect'));
  });
}
test('background does not change compact graph metrics',()=>{
  const base=result(canvas());
  const decorated=result(canvas(400,240,[node(0,0,400,240,{zone:true}),...compact()]));
  for(const metric of ['fill','nodeFill','largestBlank','aspect']) assert.equal(decorated[metric],base[metric]);
  assert.equal(decorated.ok,true);
});
test('unmarked giant enclosing background fails instead of claiming density',()=>{
  const c=result(canvas(400,240,[node(0,0,400,240),node(40,40,40,40)]));
  assert.equal(c.fill,100);
  assert.equal(c.ok,false);
  assert.ok(c.reasons.includes('unclassified_background'));
});
test('dense infographic retains original 75 percent content fill requirement',()=>{
  const nodes=[node(0,0,200,120),node(200,0,200,120),node(0,120,200,120),node(200,120,200,120)];
  assert.equal(result(canvas(400,240,nodes,[],null)).ok,true);
  const sparse=result(canvas(400,240,compact(),[],null));
  assert.equal(sparse.policy,'infographic');
  assert.ok(sparse.reasons.includes('low_content_fill'));
});
test('every edge is counted, including those after the twentieth',()=>{
  const edges=Array.from({length:37},()=>edge(160,70,240,70));
  const c=result(canvas(400,240,compact(),edges));
  assert.equal(c.edges,37);
  assert.equal(c.renderedEdges,37);
  assert.equal(c.edgeLength,37*80);
});
test('long edge occupies every traversed column, not twenty samples',()=>{
  const c=result(canvas(4000,400,[],[edge(0,200,4000,200)]));
  assert.equal(c.fill,10);
  assert.equal(c.edgeLength,4000);
  assert.equal(c.renderedEdges,1);
});
test('curved cable length exceeds chord and geometry contributes to bounds',()=>{
  const c=result(canvas(400,240,compact(),[edge(160,70,240,70,{x:200,y:200})]));
  assert.ok(c.edgeLength>80);
  assert.equal(c.renderedEdges,1);
});
test('missing or invalid edge geometry fails even on a filled canvas',()=>{
  for(const bad of [{},{_geom:{p0:{x:0,y:0},ctrl:{x:NaN,y:0},p1:{x:10,y:10}}}]){
    const c=result(canvas(400,240,compact(),[bad]));
    assert.equal(c.ok,false);
    assert.equal(c.edges,1);
    assert.equal(c.missingGeometry,1);
    assert.ok(c.reasons.includes('missing_edge_geometry'));
  }
});
test('no canvases, empty canvas, decoration-only canvas, and zero size fail closed',()=>{
  assert.equal(check([]).pass,false);
  for(const cv of [canvas(400,240,[]),canvas(400,240,[node(0,0,400,240,{zone:true})]),canvas(0,240)]){
    assert.equal(check([cv]).pass,false);
  }
});
test('invalid node geometry and out-of-bounds nodes fail',()=>{
  assert.ok(result(canvas(400,240,[node(0,0,0,20)])).reasons.includes('invalid_node_geometry'));
  assert.ok(result(canvas(400,240,[...compact(),node(-1,10,40,40)])).reasons.includes('content_outside_canvas'));
});
test('font floor applies to content and decoration text',()=>{
  for(const small of [node(40,40,120,60,{font:11}),node(0,0,400,240,{zone:true,font:11})]){
    const c=result(canvas(400,240,[...compact(),small]));
    assert.equal(c.minFont,11);
    assert.ok(c.reasons.includes('font_below_floor'));
  }
  assert.equal(result(canvas(400,240,compact().map(n=>({...n,font:12})))).ok,true);
});
test('engine edge label text must not evade the font floor through data-fig-ui',()=>{
  const cv=canvas();
  cv.texts.push({textContent:'Cable',parentElement:node(0,0,20,20,{ui:true,label:true,font:11})});
  assert.ok(result(cv).reasons.includes('font_below_floor'));
});
test('hidden text and editor UI are not font offenders',()=>{
  const cv=canvas();
  cv.texts.push(...[node(0,0,20,20,{hidden:true,font:8}),node(0,0,20,20,{ui:true,font:8})]
    .map(n=>({textContent:'UI',parentElement:n})));
  assert.equal(result(cv).ok,true);
});
test('unknown policy fails rather than disabling limits',()=>{
  for(const policy of ['anything','constructor','__proto__'])
    assert.ok(result(canvas(400,240,compact(),[],policy)).reasons.includes('unknown_policy'));
});
test('boundary cells use real canvas area and scale does not alter metrics',()=>{
  const cv=canvas(410,250,[node(0,0,205,125),node(205,0,205,125),node(0,125,205,125),node(205,125,205,125)]);
  const base=result(cv);
  cv._scale=0.25;
  const scaled=result(cv);
  assert.equal(base.fill,100);
  assert.equal(scaled.fill,base.fill);
  assert.equal(scaled.minFont,base.minFont);
  assert.equal(scaled.scale,0.25);
});
test('wide outer blank band and large interior void have distinct diagnostics',()=>{
  const margin=result(canvas(800,400,[node(0,0,200,200)]));
  assert.ok(margin.reasons.includes('large_outer_margin'));
  const hole=result(canvas(800,400,[node(0,0,80,80),node(720,0,80,80),node(0,320,80,80),node(720,320,80,80)]));
  assert.ok(hole.reasons.includes('large_blank_rectangle'));
  assert.ok(!hole.reasons.includes('large_outer_margin'));
});
test('all canvases must pass and textless content reports null font',()=>{
  const cv=canvas(400,240,compact().map(n=>({...n,text:false})));
  assert.equal(result(cv).minFont,null);
  assert.equal(result(cv).ok,true);
  assert.equal(check([cv,canvas(400,240,[])]).pass,false);
});

test('rejected tall stacks fail absolute height and portrait gates',()=>{
  for(const [w,h] of [[996,3018],[760,2364],[1160,2900]]){
    const nodes=[node(430,200,300,h-300),...Array.from({length:28},(_,i)=>node(40,40+i*70,136,40))];
    const c=result(canvas(w,h,nodes));
    assert.equal(c.ok,false);
    assert.ok(c.reasons.includes('canvas_too_tall'));
    assert.ok(c.reasons.includes('long_portrait_stack'));
    assert.ok(c.reasons.includes('oversized_network_node'));
  }
});

test('absolute dimensions and portrait limits include their exact boundaries',()=>{
  const at=result(canvas(2400,1800));
  assert.ok(!at.reasons.includes('canvas_too_wide'));
  assert.ok(!at.reasons.includes('canvas_too_tall'));
  assert.ok(result(canvas(2401,1800)).reasons.includes('canvas_too_wide'));
  assert.ok(result(canvas(2400,1801)).reasons.includes('canvas_too_tall'));
  assert.ok(!result(canvas(1000,1800)).reasons.includes('long_portrait_stack'));
  assert.ok(result(canvas(1000,1801)).reasons.includes('long_portrait_stack'));
  assert.ok(result(canvas(8000,4000)).reasons.includes('canvas_too_wide'));
});

test('compact wide diagrams are not rejected only for their aspect ratio',()=>{
  const nodes=Array.from({length:7},(_,i)=>node(40+i*148,20,136,60));
  const c=result(canvas(1200,100,nodes));
  assert.equal(c.ok,true);
  assert.equal(c.aspect,12);
});

test('diagonal cables cannot paint over a large node-free region',()=>{
  const nodes=[node(0,0,300,200),node(900,0,300,200),node(0,800,300,200),node(900,800,300,200)];
  const bare=result(canvas(1200,1000,nodes));
  const crossed=result(canvas(1200,1000,nodes,[edge(300,200,900,800),edge(900,200,300,800)]));
  assert.equal(crossed.largestBlank,bare.largestBlank);
  assert.ok(crossed.reasons.includes('large_blank_rectangle'));
});

test('nodeFill is exact rectangle union rather than touched grid cells',()=>{
  const nodes=Array.from({length:72},(_,i)=>node(1+(i%6)*190,1+Math.floor(i/6)*80,136,40));
  const c=result(canvas(1200,1000,nodes));
  assert.equal(c.nodeFill,32.64);
  const overlap=result(canvas(400,240,[node(0,0,100,100),node(50,50,100,100)]));
  assert.equal(overlap.nodeFill,18.23);
});

test('multiple small enclosing panels must be classified as backgrounds',()=>{
  const nodes=[node(0,0,540,1000),node(660,0,540,1000),node(40,40,136,40),node(700,40,136,40)];
  const c=result(canvas(1200,1000,nodes));
  assert.ok(c.reasons.includes('unclassified_background'));
  assert.equal(c.ok,false);
});

test('giant unconnected name cards cannot manufacture density',()=>{
  const c=result(canvas(1200,1000,[node(0,0,600,1000),node(600,0,600,1000)]));
  assert.equal(c.nodeFill,100);
  assert.equal(c.oversizedNodes,2);
  assert.ok(c.reasons.includes('oversized_network_node'));
});

test('port demand is shared across views for an inactive lifecycle card',()=>{
  const before=node(400,100,136,500,{dataset:{deviceName:'hub'}});
  const after=node(400,100,136,500,{dataset:{deviceName:'hub'}});
  const edges=Array.from({length:20},(_,i)=>edge(150,110+i*24,400,110+i*24));
  const checked=check([canvas(1000,800,[before]),canvas(1000,800,[after],edges)]);
  assert.equal(checked.canvases[0].oversizedNodes,0);
  assert.equal(checked.canvases[1].oversizedNodes,0);
});

test('normalized connection length is a gate rather than unused telemetry',()=>{
  const c=result(canvas(400,240,compact(),[edge(0,0,400,240,{x:400,y:0})]));
  assert.ok(c.meanEdgeRatio>1);
  assert.ok(c.reasons.includes('excessive_edge_length'));
});

test('floating point boundary noise does not put a cable outside the canvas',()=>{
  const c=result(canvas(400,240,compact(),[edge(160,70,400+1e-10,170)]));
  assert.ok(!c.reasons.includes('content_outside_canvas'));
});

test('an infographic content card may contain a small badge',()=>{
  const c=result(canvas(600,400,[node(40,40,500,320),node(50,50,20,20)],[],'infographic'));
  assert.ok(!c.reasons.includes('unclassified_background'));
});

test('visible multiline network text may require a tall card',()=>{
  const c=result(canvas(400,240,[node(40,40,136,150,{text:'Multiline content',textHeight:130})]));
  assert.equal(c.oversizedNodes,0);
});

test('inflating the same name-only grid cannot rescue its quality verdict',()=>{
  const cards=size=>Array.from({length:12},(_,i)=>node(40+(i%4)*400,40+Math.floor(i/4)*300,...size));
  const normal=result(canvas(1600,1000,cards([136,60])));
  const inflated=result(canvas(1600,1000,cards([320,120])));
  assert.equal(normal.oversizedNodes,0);
  assert.equal(inflated.oversizedNodes,12);
  assert.equal(inflated.ok,false);
});

test('a compact inventory may show isolated devices without fabricating cables',()=>{
  const c=result(canvas());
  assert.equal(c.edges,0);
  assert.equal(c.ok,true);
});
