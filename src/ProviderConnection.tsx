import type {Session} from './Cloud';
import {Icon} from './Icons';
export function ProviderConnection(_props:{session:Session;onDone:()=>void}){
 return <div className="subscription-connections"><p className="fine">Connect a subscription to bring your models into Mowr.</p><div className="security-block"><h3>Codex · Sign in with ChatGPT</h3><p className="fine">Subscription sign-in is being prepared. It is not available in Mowr yet.</p><button className="secondary" disabled>Connection not available yet</button><p className="fine"><a href="https://developers.openai.com/codex/auth" target="_blank" rel="noreferrer">About Codex subscription access <Icon name="arrow" size={12}/></a></p></div><div className="security-block"><h3>Grok</h3><p className="fine">Grok subscription connection is not available in Mowr yet.</p><button className="secondary" disabled>Connection not available yet</button></div></div>;
}
