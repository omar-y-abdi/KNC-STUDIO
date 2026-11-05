# Hero brand morph — visual candidate

Base: user-approved scroll implementation `eb8b6f2`. The native carriers, their dimensions,
scroll positions, priming and booking lifetime remain unchanged. This change is decorative.

The existing hero h1 receives a runtime marker without inserting a new source-tree parent or
changing native IDs. Its original SVG/custom owner image is retained. Layout offsets and asset
sizes determine a reversible scale/translation path; the transformed client rectangle is never
fed back into the next transform. The original asset's filter/fit/style properties remain on it.

Actions and information fade in the first 30% of the fold. The brand shrinks first, moves upward
through the middle, then travels left above the controls. CornerMark starts its crossfade only
in the last 14%, after that path reaches the compact emblem anchor. Hero overflow no longer
clips the brand, and the brand's own stacking layer sits above the header background. No timed
transition drives the brand, so scrolling upward retraces the same states. Reduced motion keeps
the content fading but removes decorative travel and scaling.

The canvas uses the same motion calculation and painting function. Existing native IDs remain;
the current review callback prop/spread were removed only to match the separately approved
review-UI change, without editing AboutSection or review behavior here.

Focused existing unit specifications were extended for phase order, matching crossfade weights,
reverse determinism and reduced motion. They have NOT been run locally, per the user's instruction.
No local automated tests, build, Docker or GitHub push were performed. This first candidate is
awaiting root's short GIF capture and the explicitly requested GPT-6-Luna visual review. It is not
yet a claim of final visual acceptance or physical-device verification.
