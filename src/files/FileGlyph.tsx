import type {StoredFile} from '../../core/types';
import './file-glyph.css';

/** A file's kind, read from its name and type. */
export const fileKind=(f:Pick<StoredFile,'name'|'type'>)=>/\.pdf$/i.test(f.name)?'pdf':/\.(docx?|odt|rtf)$/i.test(f.name)?'doc':/\.(pptx?|key|odp)$/i.test(f.name)?'slides':/\.(xlsx?|csv|ods)$/i.test(f.name)?'sheet':(f.type||'').startsWith('image/')||/\.(png|jpe?g|gif|webp|svg)$/i.test(f.name)?'image':/\.(zip|rar|7z|tar|gz)$/i.test(f.name)?'archive':'text';
const label:Record<string,string>={pdf:'PDF',doc:'DOC',slides:'PPT',sheet:'XLS',image:'IMG',archive:'ZIP',text:'TXT'};
/** What each kind shows on its page, above the label: lines of text, a grid, a slide, a picture, a zip. */
const marks:Record<string,string[]>={
  pdf:['M11 10h5','M11 14h10'],
  doc:['M11 10h10','M11 14h7'],
  text:['M11 10h10','M11 14h10'],
  sheet:['M11 9.5h10v6H11Z','M16 9.5v6','M11 12.5h10'],
  slides:['M11 9.5h10v6H11Z','M14.5 11.5l2.5 1.5-2.5 1.5Z'],
  image:['M11 15.5l3.2-3.6 2.3 2.4 1.6-1.6 2.9 2.8','M19 9.8v.1'],
  archive:['M15 5v2M17 7.5v2M15 10v2M17 12.5v2'],
};

/** A file drawn as a sheet with a folded corner, a mark for what is inside and its kind on a tab, in the pen and
 *  32-unit grid of the app's icons. On hover of its row the corner folds again and the page lifts. */
export function FileGlyph({file,size=34}:{file:Pick<StoredFile,'name'|'type'>;size?:number}){
  const k=fileKind(file);
  return <span className={`file-glyph fg-${k}`} style={{width:size,height:size}} aria-hidden="true">
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <g className="fg-page">
        <path className="fg-paper" d="M9 3h10.5L26 9.5V27a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/>
        <path className="fg-fold" pathLength={1} d="M19.5 3v4.5a2 2 0 0 0 2 2H26"/>
        {marks[k].map((d,i)=><path key={i} className="fg-mark" pathLength={1} d={d} style={{animationDelay:`${.08*i}s`}}/>)}
      </g>
      <rect className="fg-tab" x="3" y="18.5" width="17" height="8" rx="2"/>
      <text className="fg-label" x="11.5" y="24.6" textAnchor="middle">{label[k]}</text>
    </svg>
  </span>;
}
