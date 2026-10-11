'use strict';
const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
function moveAxis(rect, desired, axis, obstacles) {
  let value=desired;
  for(const b of obstacles){
    const other=axis==='x'?'y':'x';
    const size=axis==='x'?'width':'height';
    if(!(rect[other]<b[other]+b[other==='x'?'width':'height'] && rect[other]+rect[other==='x'?'width':'height']>b[other])) continue;
    if(desired>rect[axis] && rect[axis]+rect[size]<=b[axis] && desired+rect[size]>b[axis]) value=Math.min(value,b[axis]-rect[size]);
    if(desired<rect[axis] && rect[axis]>=b[axis]+b[size] && desired<b[axis]+b[size]) value=Math.max(value,b[axis]+b[size]);
  }
  return {...rect,[axis]:value};
}
function snap(rect,obstacles,threshold=10){
  let best=null;
  for(const b of obstacles){
    const yIntersects=rect.y<b.y+b.height && rect.y+rect.height>b.y;
    const xIntersects=rect.x<b.x+b.width && rect.x+rect.width>b.x;
    if(yIntersects) for(const x of [b.x+b.width,b.x-rect.width]) { const d=Math.abs(rect.x-x); if(d<=threshold && (!best||d<best.d)) best={axis:'x',value:x,d}; }
    if(xIntersects) for(const y of [b.y+b.height,b.y-rect.height]) { const d=Math.abs(rect.y-y); if(d<=threshold && (!best||d<best.d)) best={axis:'y',value:y,d}; }
  }
  if(!best)return rect;
  const result={...rect,[best.axis]:best.value};
  return obstacles.some(b=>overlaps(result,b))?rect:result;
}
function moveNoOverlap(start, target, obstacles, enableSnap=true){
  // Axis-by-axis sliding: windows stop at edges but can slide along them.
  let next=moveAxis(start,target.x,'x',obstacles);
  next=moveAxis(next,target.y,'y',obstacles);
  if(obstacles.some(b=>overlaps(next,b)))return start;
  return enableSnap?snap(next,obstacles):next;
}
function placeWithoutOverlap(rect, obstacles, displays){
  if(!obstacles.some(b=>overlaps(rect,b)))return rect;
  const candidates=[];
  for(const b of obstacles){
    candidates.push([b.x+b.width,rect.y],[b.x-rect.width,rect.y],[rect.x,b.y+b.height],[rect.x,b.y-rect.height]);
    candidates.push([b.x+b.width,b.y],[b.x-rect.width,b.y],[b.x,b.y+b.height],[b.x,b.y-rect.height]);
  }
  for(const d of displays){
    const a=d.workArea||d.bounds;
    candidates.push([a.x,a.y],[a.x+a.width-rect.width,a.y],[a.x,a.y+a.height-rect.height]);
  }
  candidates.sort((a,b)=>(a[0]-rect.x)**2+(a[1]-rect.y)**2-((b[0]-rect.x)**2+(b[1]-rect.y)**2));
  for(const [x,y] of candidates){
    const candidate={...rect,x:Math.round(x),y:Math.round(y)};
    if(!obstacles.some(b=>overlaps(candidate,b)) && displays.some(d=>{const a=d.workArea||d.bounds;return candidate.x>=a.x&&candidate.y>=a.y&&candidate.x+candidate.width<=a.x+a.width&&candidate.y+candidate.height<=a.y+a.height;}))return candidate;
  }
  return null;
}
module.exports={overlaps,moveNoOverlap,placeWithoutOverlap};
