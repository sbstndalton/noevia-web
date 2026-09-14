// Shared live light field. Rounded-distance math adapted from liquid-glass-js
// (c) 2025 Armagan Amcalar, MIT; see liquid-glass-LICENSE.txt.
// No DOM screenshots, remote textures, pointer mirrors or per-control renderers.
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more)');
  const canvas = document.createElement('canvas');
  canvas.className = 'glass-scene'; canvas.setAttribute('aria-hidden','true');
  const gl = canvas.getContext('webgl', {alpha:true, premultipliedAlpha:false, antialias:false, depth:false, preserveDrawingBuffer:false});
  if (!gl) return;
  const vertex = `attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}`;
  const fragment = `precision mediump float;
    uniform vec2 size; uniform float time; uniform float dark;
    uniform vec4 panels[12]; uniform float radii[12];
    float roundedDistance(vec2 p,vec2 box,float r){
      vec2 corner=abs(p-box*.5)-(box*.5-r);
      return length(max(corner,0.))+min(max(corner.x,corner.y),0.)-r;
    }
    vec3 light(vec2 uv){
      vec2 a=vec2(.5+.38*sin(time*.19),.5+.38*cos(time*.13));
      vec2 b=vec2(.5+.4*cos(time*.15+2.),.5+.35*sin(time*.17));
      vec2 c=vec2(.5+.35*sin(time*.11+4.),.5+.4*cos(time*.16+1.));
      float x=exp(-7.*dot(uv-a,uv-a)),y=exp(-9.*dot(uv-b,uv-b)),z=exp(-10.*dot(uv-c,uv-c));
      return vec3(.48,.69,.77)*x+vec3(.72,.60,.48)*y+vec3(.63,.60,.75)*z;
    }
    void main(){
      vec2 p=vec2(gl_FragCoord.x,size.y-gl_FragCoord.y),uv=p/size;
      float rim=0.;
      for(int i=0;i<12;i++){
        vec4 b=panels[i];
        if(b.z>0.){
          vec2 q=p-b.xy; float d=roundedDistance(q,b.zw,radii[i]);
          if(d<0.){
            vec2 n=normalize(vec2(roundedDistance(q+vec2(1.,0.),b.zw,radii[i])-d,roundedDistance(q+vec2(0.,1.),b.zw,radii[i])-d)+vec2(.0001));
            float edge=exp(d*.22)*(1.-exp(d*1.5)); uv+=n*edge*.012; rim=max(rim,edge*.035);
          }
        }
      }
      vec3 color=light(uv); color=mix(vec3(dot(color,vec3(.299,.587,.114))),color,dark); float strength=mix(.055,.12,dark);
      gl_FragColor=vec4(color+rim, strength);
    }`;
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);return null;}return s;}
  const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
  if(!vs||!fs)return;
  const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))return;
  gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const attribute=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
  const uniforms=Object.fromEntries(['size','time','dark','panels[0]','radii[0]'].map(key=>[key,gl.getUniformLocation(program,key)]));
  let lost=false,frame=0,last=0,elapsed=0,host=null,dirty=true,origin={left:0,top:0},scale=1;
  const panels=new Float32Array(48),radii=new Float32Array(12);
  const observed=new WeakSet();
  const resizeObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{dirty=true;});
  function measure(){
    const target=document.querySelector('.settings-shell[open]')||document.body;
    if(host!==target){host=target;host.prepend(canvas);}
    const rect=host===document.body?{left:0,top:0,width:innerWidth,height:innerHeight}:host.getBoundingClientRect();
    origin=rect;scale=Math.min(1,900/Math.max(rect.width,rect.height));
    canvas.width=Math.max(1,Math.round(rect.width*scale));canvas.height=Math.max(1,Math.round(rect.height*scale));
    gl.viewport(0,0,canvas.width,canvas.height);panels.fill(0);radii.fill(0);
    const nodes=host.querySelectorAll('.composer-inner,.coding-composer,.coding-side-panel,.stats-disclosure,.usage-stat,.project-card,.app-mode-switch,.settings-navigation');
    Array.from(nodes).filter(n=>n.getBoundingClientRect().width>0).slice(0,12).forEach((node,i)=>{
      if(resizeObserver&&!observed.has(node)){resizeObserver.observe(node);observed.add(node);}
      const b=node.getBoundingClientRect();panels.set([(b.left-origin.left)*scale,(b.top-origin.top)*scale,b.width*scale,b.height*scale],i*4);
      radii[i]=(parseFloat(getComputedStyle(node).borderRadius)||16)*scale;
    });dirty=false;
  }
  function draw(now){
    frame=0;if(document.hidden||preference.matches){canvas.remove();last=0;host=null;return;}
    if(now-last>=33||!last){elapsed+=last?Math.min(now-last,100):0;last=now;if(dirty)measure();
      gl.uniform2f(uniforms.size,canvas.width,canvas.height);gl.uniform1f(uniforms.time,elapsed/1000);
      gl.uniform1f(uniforms.dark,document.documentElement.dataset.theme==='dark'?1:0);
      gl.uniform4fv(uniforms['panels[0]'],panels);gl.uniform1fv(uniforms['radii[0]'],radii);gl.drawArrays(gl.TRIANGLES,0,6);
    }frame=requestAnimationFrame(draw);
  }
  function wake(){if(lost)return;dirty=true;if(!frame)frame=requestAnimationFrame(draw);}
  new MutationObserver(records=>{if(records.some(r=>r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(n=>n!==canvas)))wake();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open']});
  addEventListener('resize',wake);document.addEventListener('scroll',()=>{dirty=true;},true);
  document.addEventListener('visibilitychange',wake);preference.addEventListener('change',wake);
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;canvas.remove();});
  wake();
})();
