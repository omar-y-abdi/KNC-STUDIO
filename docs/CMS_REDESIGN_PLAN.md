# CMS Studio implementation status

The GrapesJS redesign and native-site editing shipped in PR #67. The former unchecked task list
is superseded by [CMS_PARITY.md](CMS_PARITY.md) and the
[CMS release and recovery guide](operations/CMS_RELEASE.md).

The owner edits validated HTML/CSS derived from the existing Preact site. Supabase owns revision
storage, authorization, media inventory and publication. The Worker serves published presentation;
native components retain booking, customer-access and consent behavior. Editor state is a draft,
not proof of a completed publication.

The September 21 repair addresses mismatched production backend code, obscured panels, discarded
inline styles, unusable SVG logo controls and old unstyled preview subtrees. The same repair now includes an O-Y-A-based workspace, actual outgoing email previews, shared site chrome for new pages, inspector line breaks and height-aware device fitting. Acceptance requires
both browser regression coverage and an actual owner publish/public-reload check. See the release
guide for source comparisons, release order, rollback and explicitly unverified surfaces.
