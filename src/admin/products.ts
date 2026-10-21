/** The M4 Labs products this portal administers. Accounts, emails, team and audit are lab-wide; each product adds its
 *  own sections under #/<product id>/<section>. Add a product here and give its sections a page in AdminApp. */
export type ProductSection='stats'|'cases'|'announcements';
export type Product={id:string;name:string;url:string;sections:{id:ProductSection;label:string;icon:string}[]};

export const products:Product[]=[
  {id:'clem',name:'Clem',url:'https://clem.m4labs.xyz',sections:[
    {id:'stats',label:'Stats',icon:'diagram'},
    {id:'cases',label:'Support cases',icon:'chat'},
    {id:'announcements',label:'Announcements',icon:'globe'},
  ]},
];

export const productName=(id:string)=>products.find(p=>p.id===id)?.name||id;
