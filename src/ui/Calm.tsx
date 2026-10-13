import type {CSSProperties, ReactNode} from 'react';
import {Icon} from '../Icons';
import {Illustration} from '../Illustrations';
import type {Scene} from '../vectorFilm';
import './calm.css';

/** The hand-drawn wavy rule that separates what you have from what you could start. It draws itself in once. */
export function Squiggle({className=''}:{className?:string}){
  return <div className={`calm-squiggle ${className}`} role="separator" aria-hidden="true"/>;
}

/** A page's title and one short line. No eyebrow, no paragraph: the page explains itself. */
export function PageHead({title,line,children}:{title:ReactNode;line?:ReactNode;children?:ReactNode}){
  return <header className="calm-head">
    <div className="calm-head-text"><h1>{title}</h1>{line&&<p>{line}</p>}</div>
    {children&&<div className="calm-head-actions">{children}</div>}
  </header>;
}

/** Nothing here yet: one drawing in the middle and a few words under it. */
export function EmptyState({scene,line,viewBox="60 30 360 300",children}:{scene:Scene;line:ReactNode;viewBox?:string;children?:ReactNode}){
  return <div className="calm-empty">
    <Illustration scene={scene} viewBox={viewBox} className="calm-empty-art"/>
    <p>{line}</p>
    {children&&<div className="calm-empty-actions">{children}</div>}
  </div>;
}

export type Template={
  key:string;
  icon:string;
  title:string;
  line:string;
  meta?:string;
  /** The small card that peeks up from the corner on hover: a coloured dot and its label. */
  peek?:{label:string;tone:'blue'|'green'|'lilac'|'pink'|'sand'|'clay'};
  run:()=>void;
};

/** Starting points, two to a row. Hovering one turns its icon into a plus and lifts a small card into view. */
export function Templates({items,label}:{items:Template[];label?:string}){
  return <section className="calm-templates" aria-label={label}>
    {items.map((t,i)=><button type="button" key={t.key} className="calm-template" style={{'--i':i} as CSSProperties} onClick={t.run}>
      <span className="calm-tile" aria-hidden="true"><span className="calm-tile-icon"><Icon name={t.icon} size={20}/></span><span className="calm-tile-plus"><Icon name="plus" size={20}/></span></span>
      <span className="calm-template-text">
        <b>{t.title}</b>
        <span>{t.line}</span>
        {t.meta&&<small><Icon name="clock" size={15}/>{t.meta}</small>}
      </span>
      {t.peek&&<span className={`calm-peek tone-${t.peek.tone}`} aria-hidden="true"><em><i/>{t.peek.label}</em><span/><span/></span>}
    </button>)}
  </section>;
}
