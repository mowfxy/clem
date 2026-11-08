import {useEffect} from 'react';
/** The admin portal is dark only, like m4labs.xyz: it sets the dark theme while it is open and restores the previous one after. */
export function useDarkOnly(){
  useEffect(()=>{const root=document.documentElement,before=root.dataset.theme;root.dataset.theme='dark';return()=>{if(before)root.dataset.theme=before;else delete root.dataset.theme;};},[]);
}
