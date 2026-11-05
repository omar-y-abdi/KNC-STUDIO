# Hero brand morph — visual candidate

Base: user-approved scroll implementation `eb8b6f2`. The native carriers, their dimensions,
scroll positions, priming and booking lifetime remain unchanged. This change is decorative.

The existing hero h1 receives a runtime marker without inserting a new source-tree parent or
changing native IDs. Its original SVG/custom owner image is retained. Layout offsets and asset
sizes determine a reversible scale/translation path; the transformed client rectangle is never
fed back into the next transform. The original asset's filter/fit/style properties remain on it.

The first visual candidate was rejected: it shrank the full lockup to a tiny emblem before a
separate sideways move. The second shared-frame candidate was closer, but its two full-SVG
wordmarks overlapped and the branding crossed the still-visible controls.

The current candidate follows the user's explicit sequence. Existing SVG nodes carry semantic
part attributes without new hierarchy or native IDs. Ancillary hero details/actions fade during
the first 25%; the controls fade during the first 12% and stay inert while invisible. The original
BLADE & BLEND text remains the only visible wordmark during travel. Its baseline, font size,
weight and letter spacing interpolate to the compact text's exact final metrics; at arrival the
static compact text replaces it. B&B and BNB share a moving emblem center and blend locally,
without a second complete wordmark. Decorative travel ends at 85%, before the phone/control row
fades back during the final 10%. Reverse scrolling follows the same values in reverse.

Uploaded logos remain intact: they use a fade to the compact banner, without decomposition or
cropping. Reduced motion removes decorative travel and uses fading at the original positions.
The capture cleanup includes the SVG transform/font properties, retaining original CMS baselines.

The canvas uses the same motion calculation and painting function. Existing native IDs remain;
the current review callback prop/spread were removed only to match the separately approved
review-UI change, without editing AboutSection or review behavior here.

Focused existing unit specifications cover emblem crossfade weights, arrival before the control
return, invisible-control intervals, reverse determinism and reduced motion. They have NOT been run locally, per the user's instruction.
No local automated tests, build, Docker or GitHub push were performed. This revised candidate is
awaiting root's short GIF capture and the explicitly requested GPT-6-Luna visual review. It is not
yet a claim of final visual acceptance or physical-device verification.

Capture follow-up: `snapshotNative` clones live inline styles before assigning `data-knc-light`.
The painter records original motion-owned CSS properties and inert values; capture
restores those values on the clone and removes the private motion metadata. Unrelated owner
styles and CSS priorities remain intact, and the live visual state is not reset. The existing
CMS-native capture fixture now checks this boundary; that assertion is also unrun locally.
The hero parent becomes inert only after both brand and action fades finish, so reduced-motion
buttons remain interactive throughout their visible fade.
