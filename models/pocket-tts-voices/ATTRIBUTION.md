# Pocket TTS voice states hosted by Animama

This set holds 30 Pocket TTS `english_2026-04` voice states: 23 that
the Animama app downloads on demand, and the self-encoded states of core voices
that ship with the app. 6 are Kyutai precomputed states, redistributed
unmodified; 24 are encoded by Animama. Other core voices come from Hugging Face
directly and are not part of this set.

Upstream model: Kyutai Pocket TTS, english_2026-04 checkpoint
Source: https://huggingface.co/kyutai/pocket-tts
Pinned model-card revision: 75cfe24e3142233bb81887fed3482e9652bb4a6e
Model-card license: Creative Commons Attribution 4.0 International (CC BY 4.0)
Model-card license URL: https://creativecommons.org/licenses/by/4.0/

The Animama-encoded states were computed with this checkpoint's ONNX export by
KevinAHM/pocket-tts-onnx (revision 58a6d00cf13d239b6748cb0769f35c580a8f606c,
onnx/english_2026-04; CC BY 4.0, inherited from Kyutai): its FP32 Mimi encoder,
learned BOS row and INT8 flow LM.

Voices in this set (30)

Kyutai precomputed voice states (6), redistributed unmodified
Source: https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/4e1e0a3e611c51c0b4ed8174fc10f32a54644303/languages/english_2026-04/embeddings
Pinned revision: 4e1e0a3e611c51c0b4ed8174fc10f32a54644303
Repository license: CC-BY-4.0 (the published states)
Kyutai computed each state from a recording published at
https://huggingface.co/kyutai/tts-voices (README revision 323332d33f997de8394f24a193e1a76df720e01a),
which records each recording's license, listed per voice:

- anna (downloaded on demand): kyutai/tts-voices vctk/p228_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- caro_davy (downloaded on demand): kyutai/tts-voices voice-zero/caro_davy.wav (Voice-Zero, LibriVox); CC0-1.0
- eponine (downloaded on demand): kyutai/tts-voices vctk/p262_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- fantine (downloaded on demand): kyutai/tts-voices vctk/p244_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- mary (downloaded on demand): kyutai/tts-voices vctk/p333_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- charles (downloaded on demand): kyutai/tts-voices vctk/p254_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0

Animama-encoded VCTK voice states (24)
Encoded by Animama with the english_2026-04 Mimi encoder, learned BOS row and
INT8 flow LM (scripts/voices in the Animama source) from Kyutai-enhanced clips
at https://huggingface.co/kyutai/tts-voices (revision 323332d33f997de8394f24a193e1a76df720e01a,
vctk/<speaker>_023_enhanced.wav).
Recordings: CSTR VCTK Corpus (Centre for Speech Technology Research,
University of Edinburgh; https://datashare.ed.ac.uk/handle/10283/3443),
enhanced by Kyutai using ai-coustics. License: Creative Commons Attribution
4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/.

- clara: VCTK speaker p236, sentence 023
- imogen: VCTK speaker p233, sentence 023
- lucy: VCTK speaker s5, sentence 023
- olivia: VCTK speaker p300, sentence 023
- thandi: VCTK speaker p314, sentence 023
- aoife (downloaded on demand): VCTK speaker p283, sentence 023
- beatrice (downloaded on demand): VCTK speaker p267, sentence 023
- brooke (downloaded on demand): VCTK speaker p299, sentence 023
- chloe (downloaded on demand): VCTK speaker p307, sentence 023
- emily (downloaded on demand): VCTK speaker p308, sentence 023
- florence (downloaded on demand): VCTK speaker p276, sentence 023
- grace (downloaded on demand): VCTK speaker p305, sentence 023
- harriet (downloaded on demand): VCTK speaker p231, sentence 023
- leah (downloaded on demand): VCTK speaker p317, sentence 023
- madison (downloaded on demand): VCTK speaker p294, sentence 023
- niamh (downloaded on demand): VCTK speaker p238, sentence 023
- orla (downloaded on demand): VCTK speaker p351, sentence 023
- siobhan (downloaded on demand): VCTK speaker p266, sentence 023
- sophie (downloaded on demand): VCTK speaker p343, sentence 023
- noah: VCTK speaker p334, sentence 023
- oliver: VCTK speaker p232, sentence 023
- callum (downloaded on demand): VCTK speaker p241, sentence 023
- ethan (downloaded on demand): VCTK speaker p311, sentence 023
- jack (downloaded on demand): VCTK speaker p326, sentence 023

License basis: every voice state in this set is licensed CC BY 4.0, which permits
commercial use with the attribution above. Kyutai publishes its precomputed states
under CC BY 4.0, and the Animama-encoded states derive from CC BY 4.0 VCTK
recordings. The recording behind caro_davy is dedicated CC0 1.0.
Kyutai's Pocket TTS model-card prohibited-use terms apply to every voice.
