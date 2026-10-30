import {ProfileAvatar, ProfilePicker} from '../ProfileAvatar';
import {Icon} from '../Icons';
import {SettingsCard, SettingRow} from './SettingsParts';

const greeting=(name:string)=>`${new Date().getHours()<12?'Morning':new Date().getHours()<18?'Afternoon':'Evening'}, ${name==='Thinker'?'thinker':name||'thinker'}.`;

/** Who you are in Clem: how Clem greets you (a live preview), your name and picture, then the account. */
export function ProfileSettings({name,email,avatar,storage,onName,onAvatar,onSecurity,onFiles,onExport}:{name:string;email?:string;avatar?:string;storage:string;onName:(name:string)=>void;onAvatar:(id:string)=>void;onSecurity:()=>void;onFiles:()=>void;onExport:()=>void}){
 return <div className="st-profile">
  <div className="st-id" aria-label="Preview">
   <span className="st-id-avatar"><ProfileAvatar value={avatar} size={72}/></span>
   <div className="st-id-text"><strong>{greeting(name)}</strong>{email&&<span>{email}</span>}</div>
  </div>
  <SettingsCard title="Name">
   <label className="st-field">
    <span className="st-input"><input value={name} maxLength={50} placeholder="Your name" aria-label="Name" onChange={e=>onName(e.target.value)} autoComplete="nickname"/><small aria-hidden="true">{name.length}/50</small></span>
   </label>
  </SettingsCard>
  <SettingsCard title="Picture">
   <div className="st-pad"><ProfilePicker value={avatar} onChange={onAvatar}/></div>
  </SettingsCard>
  <SettingsCard title="Account">
   <SettingRow title="Storage" description={storage}><button type="button" className="secondary" onClick={onFiles}>Files <Icon name="arrow" size={15}/></button></SettingRow>
   <SettingRow title="Security"><button type="button" className="secondary" onClick={onSecurity}>Manage</button></SettingRow>
   <SettingRow title="Export"><button type="button" className="secondary" onClick={onExport}>Export <Icon name="download" size={15}/></button></SettingRow>
  </SettingsCard>
 </div>;
}
