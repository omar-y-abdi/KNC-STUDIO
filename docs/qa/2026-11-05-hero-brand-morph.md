# Hero brand morph — visual candidate

Base: user-approved scroll implementation `eb8b6f2`. The native carriers, their dimensions,
scroll positions, priming and booking lifetime remain unchanged. This change is decorative.

The existing hero h1 receives a runtime marker without inserting a new source-tree parent or
changing native IDs. Its original SVG/custom owner image is retained. Layout offsets and asset
sizes determine a reversible scale/translation path; the transformed client rectangle is never
fed back into the next transform. The original asset's filter/fit/style properties remain on it.

The first visual candidate was rejected after manual preview: it shrank the full lockup to the
small emblem's height, moved sideways separately, and left an empty middle composition.
The replacement uses one eased scroll progress for the center and width of a shared frame,
from the large lockup to the complete compact banner. Both existing assets occupy that frame;
their different aspect ratios blend through a crossfade between 35% and 90% of the fold.
There is no separate sideways stage or tiny emblem-sized destination. Actions and information
fade over the first 55%, retaining visible content longer. Fully faded action boxes are inert.
Hero overflow remains visible, so it does not cut the moving brand at its own boundary.
Scrolling upward retraces the same states. Reduced motion keeps the overlapping fade at each
asset's original position and size, without decorative travel or scaling.

The canvas uses the same motion calculation and painting function. Existing native IDs remain;
the current review callback prop/spread were removed only to match the separately approved
review-UI change, without editing AboutSection or review behavior here.

Focused existing unit specifications cover overlapping crossfade weights, the shared travel
progress, the longer action fade, reverse determinism and reduced motion. They have NOT been run locally, per the user's instruction.
No local automated tests, build, Docker or GitHub push were performed. This revised candidate is
awaiting root's short GIF capture and the explicitly requested GPT-6-Luna visual review. It is not
yet a claim of final visual acceptance or physical-device verification.

Capture follow-up: `snapshotNative` clones live inline styles before assigning `data-knc-light`.
The painter therefore records only its original translate/scale/opacity/inert values; capture
restores those values on the clone and removes the private motion metadata. Unrelated owner
styles and CSS priorities remain intact, and the live visual state is not reset. The existing
CMS-native capture fixture now checks this boundary; that assertion is also unrun locally.
The hero parent becomes inert only after both brand and action fades finish, so reduced-motion
buttons remain interactive throughout their visible fade.
