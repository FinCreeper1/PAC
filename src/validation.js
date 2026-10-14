import '../public/shared/calendar-model.js';
export function validateCalendar(calendar, seed, trip, journeys) {
  const fail=()=>{throw new Error('Bitte Datum, Titel, Ort, Zeiten, Status und Routen prüfen.');};
  const base=CalendarModel.normalize(seed,trip);
  if(!calendar || calendar.schemaVersion!==2 || JSON.stringify(calendar.days)!==JSON.stringify(base.days) || JSON.stringify(calendar.timeSlots)!==JSON.stringify(base.timeSlots) || !Array.isArray(calendar.events) || calendar.events.length>200) fail();
  const bounds=CalendarModel.bounds(calendar), ids=new Set();
  const coord=(lat,lon)=>{if(typeof lat!=='number'||typeof lon!=='number'||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) fail();};
  for(const event of calendar.events) {
    if(!event || !/^[a-z0-9-]{1,64}$/.test(event.id) || ids.has(event.id)) fail();ids.add(event.id);
    for(const key of ['title','location']) if(typeof event[key]!=='string'||!event[key].trim()||event[key].length>1000) fail();
    for(const key of ['subtitle','detail','note','responsible']) if(event[key]!=null&&(typeof event[key]!=='string'||event[key].length>10000)) fail();
    if(!Number.isInteger(event.day)||event.day<1||event.day>calendar.days.length) fail();
    const start=CalendarModel.minutes(event.startTime),end=CalendarModel.minutes(event.endTime);
    if(start===null||end===null||start<bounds.start||end>bounds.end||end<=start) fail();
    for(const [key,values] of Object.entries({type:['travel','program','event','free'],status:['provisional','confirmed'],display:['normal','compact'],timing:['scheduled','unscheduled']})) if(!values.includes(event[key])) fail();
    if(event.timing==='unscheduled'&&event.status!=='provisional') fail();
    if(event.lane!=null&&!['','left','right'].includes(event.lane)) fail();
    if(event.showMap!=null&&typeof event.showMap!=='boolean') fail();
    coord(event.latitude,event.longitude);
    for(const key of ['start','end','time','style','action','topic','materialTopic','dialog','route']) if(key in event) fail();
    if(event.journeyId) {
      if(!Object.hasOwn(journeys,event.journeyId)) fail();
      const legs=CalendarModel.journey(event,journeys[event.journeyId]).legs;
      for(let i=0;i<legs.length;i++) if(CalendarModel.minutes(legs[i].arrival)<=CalendarModel.minutes(legs[i].departure)||(i&&CalendarModel.minutes(legs[i].departure)<CalendarModel.minutes(legs[i-1].arrival))) fail();
    }
    if(event.routeRef && (!/^[a-z0-9-]{1,80}$/.test(event.routeRef)||event.mapRoute)) fail();
    if(event.mapRoute) {
      const route=event.mapRoute;
      if(!Array.isArray(route.points)||route.points.length>200) fail();
      for(const point of route.points) {if(typeof point.name!=='string'||point.name.length>500) fail();coord(point.latitude,point.longitude);}
      if(route.geometry!=null) {
        if(!Array.isArray(route.geometry)||route.geometry.length>10000) fail();
        for(const point of route.geometry) {if(!Array.isArray(point)||point.length!==2) fail();coord(...point);}
      }
    }
  }
}
