/* Run in the rendered editor page; returns JSON. A pass is a geometry/font gate,
   not visual acceptance. All dimensions use the unscaled canvas coordinate system.
   See SKILL.md for the version 2 metrics, semantic exclusions, and policy limits. */
(function(){
  const CELL=40, FLOOR=12, EPS=1e-6;
  const policies={
    infographic:{minFill:75,minNodeFill:35,maxBlank:20,maxAspect:2.5,maxMargin:20},
    network:{minFill:20,minNodeFill:8,maxBlank:35,maxAspect:2,maxMargin:20,
      maxWidth:2400,maxHeight:1800,maxPortrait:1.8,maxMeanEdgeRatio:1}
  };
  const decoration='.zone,[data-fig-decoration],[data-fig-role="background"]';
  const round=n=>Math.round(n*100)/100;
  const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  const canvases=[...document.querySelectorAll('.fig-canvas')];
  // A stage's inactive card reserves the port lanes required by its other views.
  const demands=new Map();
  const key=n=>n.dataset?.deviceName||n;
  for(const cv of canvases){
    const nodes=[...cv.querySelectorAll('.fig-node')].filter(n=>!n.matches(decoration));
    for(const n of nodes){
      const counts=[0,0,0,0],x=n.offsetLeft,y=n.offsetTop,w=n.offsetWidth,h=n.offsetHeight;
      for(const edge of cv.querySelectorAll('.fig-edge')){
        if(!edge._geom) continue;
        for(const p of [edge._geom.p0,edge._geom.p1]){
          if(!finitePoint(p)||p.x<x-EPS||p.x>x+w+EPS||p.y<y-EPS||p.y>y+h+EPS) continue;
          if(Math.abs(p.x-x)<EPS) counts[0]++;
          if(Math.abs(p.x-x-w)<EPS) counts[1]++;
          if(Math.abs(p.y-y)<EPS) counts[2]++;
          if(Math.abs(p.y-y-h)<EPS) counts[3]++;
        }
      }
      const previous=demands.get(key(n))||[0,0,0,0];
      demands.set(key(n),counts.map((count,index)=>Math.max(count,previous[index])));
    }
  }
  const unionArea=rectangles=>{
    const xs=[...new Set(rectangles.flatMap(r=>[r[0],r[2]]))].sort((a,b)=>a-b);
    let total=0;
    for(let i=1;i<xs.length;i++){
      const intervals=rectangles.filter(r=>r[0]<xs[i]&&r[2]>xs[i-1])
        .map(r=>[r[1],r[3]]).sort((a,b)=>a[0]-b[0]);
      let bottom=-Infinity,covered=0;
      for(const [top,end] of intervals){
        if(end>bottom){covered+=end-Math.max(top,bottom);bottom=end;}
      }
      total+=(xs[i]-xs[i-1])*covered;
    }
    return total;
  };
  const out={version:2,pass:true,canvases:[],offenders:[]};
  canvases.forEach((cv,i)=>{
    const W=cv.offsetWidth,H=cv.offsetHeight;
    const policy=cv.dataset.figQuality||'infographic';
    const limits=Object.hasOwn(policies,policy)?policies[policy]:null;
    const reasons=[];
    if(!limits) reasons.push('unknown_policy');
    if(!(W>0&&H>0&&Number.isFinite(W)&&Number.isFinite(H))){
      out.canvases.push({canvas:i+1,size:W+'x'+H,fill:0,nodeFill:0,minFont:null,
        ok:false,reasons:['invalid_canvas_size']});
      out.pass=false; return;
    }
    const cols=Math.ceil(W/CELL),rows=Math.ceil(H/CELL);
    const scale=cv.getBoundingClientRect().width/W;
    const textSize=node=>{
      const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT,null);
      let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      while(walker.nextNode()){
        const text=walker.currentNode,el=text.parentElement;
        if(!text.textContent.trim()||!el||el.closest('.port,[data-fig-ui]')) continue;
        const range=document.createRange();
        range.selectNodeContents(text);
        for(const rect of range.getClientRects()){
          left=Math.min(left,rect.left);top=Math.min(top,rect.top);
          right=Math.max(right,rect.right);bottom=Math.max(bottom,rect.bottom);
        }
      }
      const style=getComputedStyle(node);
      return {
        width:left===Infinity?0:(right-left)/scale+
          parseFloat(style.paddingLeft)+parseFloat(style.paddingRight),
        height:top===Infinity?0:(bottom-top)/scale+
          parseFloat(style.paddingTop)+parseFloat(style.paddingBottom)
      };
    };
    const nodeHit=new Uint8Array(cols*rows),hit=new Uint8Array(cols*rows);
    let bounds=null;
    const include=(x,y)=>{
      if(!bounds) bounds={left:x,top:y,right:x,bottom:y};
      bounds.left=Math.min(bounds.left,x); bounds.top=Math.min(bounds.top,y);
      bounds.right=Math.max(bounds.right,x); bounds.bottom=Math.max(bounds.bottom,y);
    };
    const mark=(x,y,target)=>{
      const cx=Math.floor(x/CELL),cy=Math.floor(y/CELL);
      if(cx>=0&&cy>=0&&cx<cols&&cy<rows) target[cy*cols+cx]=1;
    };
    const allNodes=[...cv.querySelectorAll('.fig-node')];
    // Exclude the decorative element itself, not substantive nodes inside a group.
    const nodes=allNodes.filter(n=>!n.matches(decoration));
    let invalidNodes=0,oversizedContainers=0,oversizedNodes=0;
    const rectangles=[];
    nodes.forEach(n=>{
      const x=n.offsetLeft,y=n.offsetTop,w=n.offsetWidth,h=n.offsetHeight;
      if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0){ invalidNodes++; return; }
      include(x,y); include(x+w,y+h);
      if(x<-EPS||y<-EPS||x+w>W+EPS||y+h>H+EPS) reasons.push('content_outside_canvas');
      rectangles.push([Math.max(0,x),Math.max(0,y),Math.min(W,x+w),Math.min(H,y+h)]);
      // Name-only network boxes cannot contain device cards. Generic content cards may
      // contain badges; only a near-canvas enclosing panel is ambiguous in that policy.
      if((policy==='network'||w*h>=W*H*0.8)&&
          nodes.some(m=>m!==n&&m.offsetLeft>=x&&m.offsetTop>=y&&
          m.offsetLeft+m.offsetWidth<=x+w&&m.offsetTop+m.offsetHeight<=y+h)) oversizedContainers++;
      if(policy==='network'){
        const [left,right,top,bottom]=demands.get(key(n));
        const content=textSize(n);
        const allowedWidth=Math.max(136,content.width+16,26*(Math.max(top,bottom)+1)/0.8);
        const allowedHeight=Math.max(64,content.height+16,24*(Math.max(left,right)+1)/0.8);
        if(w>allowedWidth+EPS||h>allowedHeight+EPS) oversizedNodes++;
      }
      for(let cy=Math.max(0,Math.floor(y/CELL));cy<Math.min(rows,Math.ceil((y+h)/CELL));cy++)
        for(let cx=Math.max(0,Math.floor(x/CELL));cx<Math.min(cols,Math.ceil((x+w)/CELL));cx++)
          nodeHit[cy*cols+cx]=hit[cy*cols+cx]=1;
    });
    const edges=[...cv.querySelectorAll('.fig-edge')];
    let missingGeometry=0,edgeLength=0,renderedEdges=0;
    edges.forEach(e=>{
      const g=e._geom;
      if(!g||![g.p0,g.ctrl,g.p1].every(finitePoint)){ missingGeometry++; return; }
      renderedEdges++;
      // Quadratic derivative <= 2*max(control-leg length); steps are <= CELL/8 px.
      // Thus long cables cannot collapse into the old fixed twenty sampled cells.
      const steps=Math.max(1,Math.ceil(2*Math.max(
        Math.hypot(g.ctrl.x-g.p0.x,g.ctrl.y-g.p0.y),
        Math.hypot(g.p1.x-g.ctrl.x,g.p1.y-g.ctrl.y))/(CELL/8)));
      let prev=null;
      for(let s=0;s<=steps;s++){
        const t=s/steps;
        // Difference form preserves a constant coordinate exactly on grid lines.
        const x=g.p0.x+2*t*(g.ctrl.x-g.p0.x)+t*t*(g.p1.x-2*g.ctrl.x+g.p0.x);
        const y=g.p0.y+2*t*(g.ctrl.y-g.p0.y)+t*t*(g.p1.y-2*g.ctrl.y+g.p0.y);
        include(x,y); mark(x,y,hit);
        if(x<-EPS||y<-EPS||x>W+EPS||y>H+EPS) reasons.push('content_outside_canvas');
        if(prev) edgeLength+=Math.hypot(x-prev.x,y-prev.y);
        prev={x,y};
      }
    });
    // Partial boundary cells use their real area, not a padded canvas denominator.
    const area=grid=>{
      let total=0;
      for(let y=0;y<rows;y++) for(let x=0;x<cols;x++)
        if(grid[y*cols+x]) total+=Math.min(CELL,W-x*CELL)*Math.min(CELL,H-y*CELL);
      return total;
    };
    // Largest all-empty axis-aligned grid rectangle, using a histogram stack.
    const heights=new Array(cols).fill(0);
    let blankArea=0;
    for(let y=0;y<rows;y++){
      const dy=Math.min(CELL,H-y*CELL);
      for(let x=0;x<cols;x++) heights[x]=nodeHit[y*cols+x]?0:heights[x]+dy;
      const stack=[];
      for(let x=0;x<=cols;x++){
        const h=x===cols?0:heights[x];
        let start=x;
        while(stack.length&&stack[stack.length-1].h>h){
          const p=stack.pop(); start=p.start;
          blankArea=Math.max(blankArea,p.h*(Math.min(x*CELL,W)-p.start*CELL));
        }
        if(!stack.length||stack[stack.length-1].h<h) stack.push({start,h});
      }
    }
    const fill=area(hit)/(W*H)*100;
    const nodeFill=unionArea(rectangles.filter(r=>r[2]>r[0]&&r[3]>r[1]))/(W*H)*100;
    const largestBlank=blankArea/(W*H)*100,aspect=Math.max(W/H,H/W);
    const meanEdgeRatio=renderedEdges?edgeLength/renderedEdges/Math.max(W,H):0;
    const margins=bounds?{
      left:Math.max(0,bounds.left)/W*100,top:Math.max(0,bounds.top)/H*100,
      right:Math.max(0,W-bounds.right)/W*100,bottom:Math.max(0,H-bounds.bottom)/H*100
    }:null;
    let minFont=Infinity;
    const walker=document.createTreeWalker(cv,NodeFilter.SHOW_TEXT,null);
    while(walker.nextNode()){
      const t=walker.currentNode,el=t.parentElement;
      if(!t.textContent.trim()||!el) continue;
      // Engine labels are content despite carrying data-fig-ui.
      if(el.closest('[data-fig-ui]')&&!el.closest('.fig-elabel')) continue;
      const style=getComputedStyle(el);
      if(style.display==='none'||style.visibility==='hidden'||!el.getClientRects().length) continue;
      const fs=parseFloat(style.fontSize);
      if(!Number.isFinite(fs)){ reasons.push('invalid_font_size'); continue; }
      minFont=Math.min(minFont,fs);
      if(fs<FLOOR) out.offenders.push('#'+(i+1)+' '+fs+'px: '+t.textContent.trim().slice(0,20));
    }
    if(!nodes.length&&!renderedEdges) reasons.push('empty_content');
    if(invalidNodes) reasons.push('invalid_node_geometry');
    if(oversizedContainers) reasons.push('unclassified_background');
    if(oversizedNodes) reasons.push('oversized_network_node');
    if(missingGeometry) reasons.push('missing_edge_geometry');
    if(minFont<FLOOR) reasons.push('font_below_floor');
    if(limits){
      if(fill<limits.minFill) reasons.push('low_content_fill');
      if(nodeFill<limits.minNodeFill) reasons.push('low_node_fill');
      if(largestBlank>limits.maxBlank) reasons.push('large_blank_rectangle');
      // Short banners and compact chains fit one screen even with a large ratio.
      if((W>1600||H>1000)&&aspect>limits.maxAspect) reasons.push('extreme_canvas_aspect');
      if(margins&&Math.max(...Object.values(margins))>limits.maxMargin) reasons.push('large_outer_margin');
      if(limits.maxWidth&&W>limits.maxWidth) reasons.push('canvas_too_wide');
      if(limits.maxHeight&&H>limits.maxHeight) reasons.push('canvas_too_tall');
      if(limits.maxPortrait&&H>1000&&H/W>limits.maxPortrait) reasons.push('long_portrait_stack');
      if(limits.maxMeanEdgeRatio&&meanEdgeRatio>limits.maxMeanEdgeRatio) reasons.push('excessive_edge_length');
    }
    const c={canvas:i+1,size:W+'x'+H,policy,limits,fill:round(fill),nodeFill:round(nodeFill),
      largestBlank:round(largestBlank),aspect:round(aspect),
      margins:margins&&Object.fromEntries(Object.entries(margins).map(([k,v])=>[k,round(v)])),
      contentBounds:bounds,nodes:nodes.length,excludedNodes:allNodes.length-nodes.length,
      edges:edges.length,renderedEdges,missingGeometry,edgeLength:round(edgeLength),
      meanEdgeRatio:round(meanEdgeRatio),oversizedNodes,
      minFont:minFont===Infinity?null:minFont,scale:round(cv._scale||1),
      ok:!reasons.length,reasons:[...new Set(reasons)]};
    out.pass=out.pass&&c.ok; out.canvases.push(c);
  });
  if(!out.canvases.length){ out.pass=false; out.offenders.push('no_canvases'); }
  out.offenders=out.offenders.slice(0,8);
  return JSON.stringify(out);
})()
