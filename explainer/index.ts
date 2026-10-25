import type { AnimatedScene } from '@explainer/src/kit/types';
// Side effect: declares Inter for the whole video and holds rendering until it has loaded.
import './scenes/BrandFont';
import { Opener } from './scenes/Opener';
import { Outro } from './scenes/Outro';

export { spec } from './script';

// Every `component` named by an animated scene in script.ts must be registered here.
export const components: Record<string, AnimatedScene> = { Opener, Outro };
