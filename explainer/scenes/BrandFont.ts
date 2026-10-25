import { continueRender, delayRender, staticFile } from 'remotion';

/**
 * STRATEGOS's typeface, Inter (public/fonts/, latin variable-weight subset from Fontsource, SIL Open Font License in
 * OFL.txt), for the whole video: theme.font and theme.display name it first, so titles, captions and lower thirds all
 * use it.
 *
 * Declared once when the bundle loads rather than in a scene's <style>: Remotion renders frames in several tabs and
 * out of order, so a tab drawing a footage frame never mounts the opener. Rendering waits until the weights the
 * video uses have loaded, so no frame is captured in the fallback font.
 */
const FAMILY = 'Inter';

const face = document.createElement('style');
face.textContent = `@font-face { font-family: '${FAMILY}'; src: url('${staticFile('fonts/Inter-wght.woff2')}') format('woff2'); font-weight: 100 900; font-style: normal; }`;
document.head.appendChild(face);

const handle = delayRender(`Loading ${FAMILY}`);
Promise.all(['400', '600', '700'].map((w) => document.fonts.load(`${w} 32px '${FAMILY}'`)))
  .then((loaded) => {
    if (loaded.some((faces) => faces.length === 0)) console.warn(`${FAMILY} did not load; the fallback font is used`);
    continueRender(handle);
  })
  .catch((err) => {
    console.warn(`${FAMILY} failed to load: ${err}`);
    continueRender(handle);
  });
