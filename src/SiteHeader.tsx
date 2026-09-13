import {Icon,Logo} from './Icons';
export function SiteHeader(){return <header className="marketing-nav site-header"><a className="brand" href="#/"><Logo size={28}/>mowr</a><nav><a href="#/features">Features</a><a href="#/pricing">Pricing</a><a href="#/about">About</a><a className="landing-open" href="#/login">Sign in<Icon name="arrow" size={16}/></a></nav></header>;}
