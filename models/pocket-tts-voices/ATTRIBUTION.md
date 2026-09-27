# Pocket TTS voice states

Built-in voices (38)

Core voices ship with the app; the others are downloaded on demand from
https://downloads.animama.ai/models/pocket-tts-voices/, where each state is published under its own SHA-256.

Kyutai precomputed voice states (14), redistributed unmodified
Source: https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/4e1e0a3e611c51c0b4ed8174fc10f32a54644303/languages/english_2026-04/embeddings
Pinned revision: 4e1e0a3e611c51c0b4ed8174fc10f32a54644303
Repository license: CC-BY-4.0 (the published states)
Kyutai computed each state from a recording published at
https://huggingface.co/kyutai/tts-voices (README revision 323332d33f997de8394f24a193e1a76df720e01a),
which records each recording's license, listed per voice:

- azelma: kyutai/tts-voices vctk/p303_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- jane: kyutai/tts-voices vctk/p339_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- anna (downloaded on demand): kyutai/tts-voices vctk/p228_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- caro_davy (downloaded on demand): kyutai/tts-voices voice-zero/caro_davy.wav (Voice-Zero, LibriVox); CC0-1.0
- eponine (downloaded on demand): kyutai/tts-voices vctk/p262_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- eve (default voice): kyutai/tts-voices vctk/p361_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- fantine (downloaded on demand): kyutai/tts-voices vctk/p244_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- mary (downloaded on demand): kyutai/tts-voices vctk/p333_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- bill_boerst: kyutai/tts-voices voice-zero/bill_boerst.wav (Voice-Zero, LibriVox); CC0-1.0
- javert: kyutai/tts-voices voice-donations/Butter.wav (Unmute Voice Donation Project, Kyutai); CC0-1.0
- marius: kyutai/tts-voices voice-donations/Selfie.wav (Unmute Voice Donation Project, Kyutai); CC0-1.0
- michael: kyutai/tts-voices vctk/p360_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
- paul: kyutai/tts-voices vctk/p259_023_enhanced.wav (CSTR VCTK Corpus, University of Edinburgh); CC-BY-4.0
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

Kyutai's Pocket TTS model-card prohibited-use terms apply to every voice.
