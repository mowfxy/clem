import {useEffect} from 'react';
/** The privacy policy and terms live on m4labs.xyz, as plain pages Google and other crawlers can read. Old #/privacy
 *  and #/terms links land there. Edit the words in the m4labs-site repository (src/legal.mjs). */
export function Legal({route}:{route:string}){
 const target='https://m4labs.xyz'+(route==='/privacy'?'/privacy':'/terms');
 useEffect(()=>{location.replace(target);},[target]);
 return <main className="workspace-loading" role="status"><a href={target}>{route==='/privacy'?'Privacy Policy':'Terms of Service'}</a></main>;
}
