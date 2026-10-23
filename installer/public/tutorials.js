document.addEventListener('toggle',event=>{
 if(event.target.matches?.('.cloud-video-help')&&!event.target.open)event.target.querySelector('video')?.pause();
},true);
document.addEventListener('play',event=>{
 if(event.target.matches?.('video.cloud-video'))for(const video of document.querySelectorAll('video.cloud-video'))if(video!==event.target)video.pause();
},true);
