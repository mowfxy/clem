import {Icon,Logo} from '../Icons';

const steps=['Read the lecture notes','Pull out key definitions','Write practice questions','Build the revision pack'];

/** An animated miniature of the Mowr workspace: a project, its sources, and a task producing a real file. */
export function ProductMock(){
  return <div className="sx-mock" role="img" aria-label="The Mowr workspace: a Thermodynamics project with its sources, running a four-step task that produces an editable revision pack.">
    <div className="sx-mock-bar"><span/><span/><span/></div>
    <div className="sx-mock-body">
      <aside className="sx-mock-side" aria-hidden="true">
        <div className="sx-mock-logo"><Logo size={18}/>mowr</div>
        {[['new','New chat'],['projects','Projects'],['subjects','Subjects'],['visuals','Visuals'],['files','Files']].map(([icon,label],i)=><div key={icon} className={`sx-mock-nav ${i===1?'on':''}`}><Icon name={icon} size={14}/>{label}</div>)}
        <small>Recent</small>
        {['Thermodynamics','Grant proposal','Q3 notes'].map(t=><div key={t} className="sx-mock-hist"><i/>{t}</div>)}
      </aside>
      <div className="sx-mock-main" aria-hidden="true">
        <div className="sx-mock-crumb">Projects <span>/</span> Thermodynamics</div>
        <div className="sx-mock-sources">{[['files','Week 1–4 notes.pdf'],['files','Past paper.docx'],['globe','Lecture video']].map(([i,t],n)=><span key={t} style={{animationDelay:n*.12+'s'}}><Icon name={i} size={12}/>{t}</span>)}</div>
        <div className="sx-mock-user">Turn my notes into a revision pack with practice questions.</div>
        <div className="sx-mock-plan">
          <header><Icon name="long" size={15}/><strong>Task</strong><span className="sx-mock-progress"><i/></span></header>
          {steps.map((title,i)=><div key={title} className={`sx-mock-step sx-mock-step-${i}`}><span className="sx-mock-check"/><strong>{title}</strong></div>)}
        </div>
        <div className="sx-mock-file"><Icon name="files" size={16}/><div><strong>Revision pack.docx</strong><small>12 pages · editable</small></div></div>
        <div className="sx-mock-composer"><span>Ask anything…</span><b>↑</b></div>
      </div>
    </div>
  </div>;
}
