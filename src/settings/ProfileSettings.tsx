import {ProfileAvatar, ProfilePicker} from '../ProfileAvatar';
import {Icon} from '../Icons';
import {SettingsCard, SettingRow} from './SettingsParts';

const greeting=(name:string)=>`${new Date().getHours()<12?'Morning':new Date().getHours()<18?'Afternoon':'Evening'}, ${name==='Thinker'?'thinker':name||'thinker'}.`;

/** Who you are in Mowr: a live preview of how you appear, your name and picture, then the account itself. */
export function ProfileSettings({name,email,avatar,storage,onName,onAvatar,onSecurity,onFiles,onExport}:{name:string;email?:string;avatar?:string;storage:string;onName:(name:string)=>void;onAvatar:(id:string)=>void;onSecurity:()=>void;onFiles:()=>void;onExport:()=>void}){
 return <div className="st-profile">
  <div className="st-id" aria-label="Preview">
   <div className="st-id-card">
    <span className="st-id-avatar"><ProfileAvatar value={avatar} size={88}/></span>
    <div className="st-id-text"><strong>{name||'Your name'}</strong><span>{email||'Signed in on this PC'}</span></div>
   </div>
   <div className="st-id-greeting"><span className="st-eyebrow">How Mowr greets you</span><p>{greeting(name)}</p></div>
  </div>
  <SettingsCard title="Name">
   <label className="st-field"><span>What should Mowr call you?</span>
    <span className="st-input"><input value={name} maxLength={50} placeholder="Your name" onChange={e=>onName(e.target.value)} autoComplete="nickname"/><small aria-hidden="true">{name.length}/50</small></span>
   </label>
  </SettingsCard>
  <SettingsCard title="Picture" note="Each picture moves a little. Quiet mode in General keeps it still.">
   <div className="st-pad"><ProfilePicker value={avatar} onChange={onAvatar}/></div>
  </SettingsCard>
  <SettingsCard title="Account">
   <SettingRow title="Email" description={email||'This workspace is not signed in.'}/>
   <SettingRow title="Storage" description={`${storage} saved on this device`}><button type="button" className="secondary" onClick={onFiles}>Manage files <Icon name="arrow" size={15}/></button></SettingRow>
   <SettingRow title="Security" description="Password, email, Google sign-in and two-factor authentication."><button type="button" className="secondary" onClick={onSecurity}>Manage</button></SettingRow>
   <SettingRow title="Export your work" description="Conversations, skills and workspace settings as JSON."><button type="button" className="secondary" onClick={onExport}>Export <Icon name="download" size={15}/></button></SettingRow>
  </SettingsCard>
 </div>;
}
