# Bugs
- memory leak: chrome initially says tab takes up 600 MB
- when i delete a keyframe in creator, left panel still shows the corresponding content as "Added"
- cleanup creator UI/UX
- vrma gestures
- reaction/gesture duration
- elevenlabs voice / pocket tts voice

# New journeys
## Creator Routes
### Reactions
New Reaction ("react-{RUN_ID}"):
- Set Happy expression (value 1) at time 0
- At time 0.3s, zero out happy expression keyframe, angry expression keyframe (value 1)
- Preview Reaction in creator preview playback and verify change in expression
- Click View JSON and verify JSON is as expected
- Save expression
- Verify reaction was saved successfully in `content/local/` filesystem with correct anima-pose-clip (keyframes, poses, events, id, name)
- Navigate to `/a/library` preview and verify "react-{RUN_ID}" reaction expression changes in /a/library preview

New Reaction -> Load ("auto-react-1") -> Edit -> Library Preview -> /a/animas/ Annie loadout equip reaction -> New Chat:
- Add chaos-chibi scene vfx at time 0
- Add bang particle vfx at time 0.30
- Preview Reaction in creator preview and verify scene vfx and particle vfx appear in playback
- Click View JSON and verify JSON is as expected
- Save expression
- Verify reaction was saved successfully in `content/local/` filesystem
- Navigate to `/a/library` preview and verify "auto-react-1" reaction scene and particle vfx changes show up in /a/library preview
- Navigate to `/a/animas/` with Annie anima selected, navigate to "Loadout" tab in right panel, open Reactions
- Verify "auto-react-1" is a equippable reaction and change Mild Admiration reaction slot to "auto-react-1"
- Preview our custom created reaction in `/a/animas/` via the play button and verify particle and scene vfx are showing up in preview
- Navigate to `/a/[animaId]` via 'New Chat' sidebar link and enter the chat message "I am testing my app, please respond to this message with `emotional_tone` `admiration` and `emotional_intensity` of 1. Verify that the anima plays our custom reaction with particle and scene vfx

New Reaction -> Load ("auto-react-1") -> New:
- Verify there are no keyframes in timeline
- Click View JSON and verify JSON is an empty anima-pose-clip
- Set surprised expression (value 1) at time 0.6
- Verify that we just have the surprised expression keyframe at time 0.6 and no other keyframes
- Click View JSON and verify JSON just has the surprised expression keyframe at time 0.6


