import { useMemo } from 'react';
import SpecVisual from '../visuals/SpecVisual';
import { compileVisual } from '../../core/visual-spec';
import { demoSpecs } from './demo-visuals';

/** A drawn-on-request visual for the website, compiled from the same description language as the app. */
export default function SpecDemo({ name }: { name: string }) {
  const visual = useMemo(() => compileVisual(demoSpecs[name]), [name]);
  return <SpecVisual visual={visual} compact />;
}
