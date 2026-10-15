// Avatar runtime classes
import { Avatar } from "./Avatar";
export { Avatar };
export type {
  AvatarOptions,
  AvatarPoseApplyOptions,
  AvatarStateUpdateContext,
  PoseBaseReplacementOptions,
} from "./Avatar";
export { AvatarFaceLandmarks } from "./vfx/AvatarFaceLandmarks";
export { AvatarFaceTextureAnchors } from "./vfx/AvatarFaceTextureAnchors";
export { AnimationManager } from "./AnimationManager";
export { ProceduralAnimationController } from "./ProceduralAnimationController";
export { PoseController } from "./poses/PoseController";
export type {
  AnimaPoseClipEventContext,
  AnimaPoseClipEventSink,
  PoseControllerApplyOptions,
} from "./poses/PoseController";
export {
  isVrm0,
  retargetClipSampleForVrm0,
  retargetPoseForVrm0,
} from "./poses/poseRetargeting";
export {
  AVATAR_POSE_CATALOG,
  AVATAR_POSE_CLIP_CATALOG,
  AVATAR_POSE_CLIP_IDS,
  AVATAR_POSE_IDS,
  AVATAR_REACTION_CLIP_CATALOG,
  AVATAR_REACTION_CLIP_IDS,
  AVATAR_REACTION_POOLS,
  DEFAULT_AVATAR_POSE_IDS,
  RELAXED_REST_POSE_ID,
  getAvatarPose,
  getAvatarPoseClip,
  getAvatarReactionClip,
  getResolvedAvatarPose,
  hasAvatarReactionClip,
  hasAvatarPoseClip,
  normalizeAvatarPoseClipId,
} from "./poses/catalog";
export {
  ANIMA_POSE_SCHEMA,
  applyAnimaPoseToVrm,
  cloneAnimaPose,
  cloneVRMPose,
  cloneVRMPoseTransform,
  getAnimaPoseExpressionNames,
  getAnimaPoseHumanoidBoneNames,
  isVRMHumanBoneName,
  mergeResolvedAnimaPose,
  parseAnimaPose,
  resolveAnimaPose,
  sanitizeAnimaPose,
} from "./poses/animaPose";
export type {
  AnimaPose,
  AnimaPoseApplyResult,
  AnimaPoseAuthoringTransform,
  AnimaPoseEulerDegreesTuple,
  AnimaPoseParent,
  AnimaPosePositionTuple,
  AnimaPoseQuaternionTuple,
  AnimaPoseRotationOrder,
  ResolvedAnimaPose,
  ResolveAnimaPoseById,
} from "./poses/animaPose";
export {
  ANIMA_POSE_CLIP_V2_SCHEMA,
  DEFAULT_ANIMA_POSE_CLIP_TRANSITION,
  analyzeAnimaPoseClipChannels,
  animaPoseClipHasPose,
  isAnimaPoseClipV2,
  parseAnimaPoseClip,
  RETIRED_ANIMA_POSE_CLIP_SCHEMA,
  UnsupportedAnimaPoseClipFormatError,
  unsupportedAnimaPoseClipFormatMessage,
  collectAnimaPoseClipEventsBetween,
  countAnimaPoseClipEventsByKind,
  getAnimaPoseClipFadeDuration,
  getAnimaPoseClipSampleTime,
  getAnimaPoseClipTimelineDuration,
  isAnimaPoseClipPlaybackLifetimeActive,
  isAnimaPoseClipVFXEvent,
  resolveAnimaPoseClipFadeDuration,
  resolveAnimaPoseClipFadeTransition,
  sampleAnimaPoseClipActiveEventsAtTime,
  sampleAnimaPoseClipAvatarVFXIntensity,
  sampleAnimaPoseClipVFXEventState,
  shouldAnimaPoseClipAutoComplete,
  validateAnimaPoseClipEventCatalogRefs,
} from "./poses/animaPoseClip";
export type {
  AnimaPoseClipV2,
  AnimaPoseClipActiveVFXEvent,
  AnimaPoseClipAvatarVFXEvent,
  AnimaPoseClipCatalogIdCollection,
  AnimaPoseClipChannelAnalysis,
  AnimaPoseClipDueEvent,
  AnimaPoseClipEasing,
  AnimaPoseClipEvent,
  AnimaPoseClipEventCatalogRefDiagnostics,
  AnimaPoseClipEventCatalogRefs,
  AnimaPoseClipEventCollectionOptions,
  AnimaPoseClipEventKindCounts,
  AnimaPoseClipFade,
  AnimaPoseClipInterpolation,
  AnimaPoseClipPlayback,
  AnimaPoseClipPlaybackFacts,
  AnimaPoseClipPlaybackLifetime,
  AnimaPoseClipPlaybackScope,
  AnimaPoseClipParticleVFXEvent,
  AnimaPoseClipPoseResolver,
  AnimaPoseClipRotationInterpolation,
  AnimaPoseClipRole,
  AnimaPoseClipSample,
  AnimaPoseClipSampleDiagnostics,
  AnimaPoseClipSampleResult,
  AnimaPoseClipScalarInterpolation,
  AnimaPoseClipSceneVFXEvent,
  AnimaPoseClipSceneVFXKind,
  AnimaPoseClipSFXEvent,
  AnimaPoseClipTransition,
  AnimaPoseClipVFXEnvelope,
  AnimaPoseClipVFXEvent,
  AnimaPoseClipVFXEventState,
  AnimaPoseClipVFXIntensityEnvelope,
  AnimaPoseClipVFXParameterKeyframe,
  AnimaPoseSnapshot,
  ResolvedAnimaPoseClipTransition,
} from "./poses/animaPoseClip";
export {
  ReactionClipPlayer,
  getReactionClipEventAppliedId,
} from "./reaction/ReactionClipPlayer";
export type {
  ReactionClipClearOptions,
  ReactionClipPlaybackPhase,
  ReactionClipPlayerOptions,
  ReactionClipPlayerSnapshot,
  ReactionClipPlayRequest,
  ReactionExpressionOverlaySink,
} from "./reaction/ReactionClipPlayer";
export { SpringBonePhysicsController } from "./spring-bone/SpringBonePhysicsController";
export {
  DEFAULT_SPRING_BONE_SEMANTIC_PROFILES,
  SPRING_BONE_SEMANTICS,
  UNPROFILED_SPRING_BONE_INTENSITY_SCALE,
} from "./spring-bone/SpringBoneSemanticProfile";
export { VRMDocument } from "./VRMDocument";
export { VRMEditorSession } from "./VRMEditorSession";
export { AvatarVFXController } from "./vfx/AvatarVFXController";
export {
  AVATAR_PARTICLE_VFX_CATALOG,
  PARTICLE_VFX_ANCHORS,
  ParticleVFXController,
  cloneParticleVFXTransform,
  createDefaultParticleVFXTransform,
  getParticleVFXCatalogEntryById,
  getParticleVFXCatalogIds,
  getParticleVFXCombinedOffset,
  isParticleVFXAnchor,
  mergeParticleVFXTransform,
  normalizeParticleVFXTransform,
  resolveParticleVFXAnchorLocalPosition,
} from "./particle-vfx";
export type {
  ParticleVFXAnchor,
  ParticleVFXCatalogEntry,
  ParticleVFXControllerSnapshot,
  ParticleVFXPlayRequest,
  ParticleVFXResolvedAnchor,
  ParticleVFXRuntimeLifetime,
  ParticleVFXRuntimeInstance,
  ParticleVFXRuntimeInstanceSnapshot,
  ParticleVFXShapeAutoFit,
  ParticleVFXTransform,
  ParticleVFXTransformAxisTriple,
  ParticleVFXTransformInput,
} from "./particle-vfx";
export {
  getAvatarVFXRegion,
  getAvatarVFXApplyMode,
  getAvatarVFXRenderMode,
  getAvatarVFXTargetRole,
  isAvatarVFXRegion,
  isAvatarVFXRegionStackable,
  isBoxHoverVFXEntry,
  isEyeHoverVFXEntry,
  isMouthHoverVFXEntry,
  isFaceAnchoredVFXEntry,
  isHoverVFXEntry,
  isTextureVFXEntry,
} from "./vfx/types";
export { ExpressionController } from "./ExpressionController";
export {
  EMOTION_EXPRESSION_INTENSITIES,
  EMOTION_INTENSITY_MAP,
} from "./emotionExpressionPresets";
export {
  getIncludedReactionPool,
  normalizeEmotionReactionIntensity,
  resolveEmotionReactionTone,
} from "./reactionClips";
export type {
  EmotionReactionTone,
  NormalizedEmotionReactionIntensity,
} from "./reactionClips";
export type { EmotionReactionIntensity } from "./reactionPools";
export {
  DEFAULT_IDLE_STINT_QUIET_INTERVAL_SEC,
  NON_TTS_REACTION_CLIP_VISIBLE_DURATION_MS,
  AvatarPlanner,
  calculateMotionClipEffectiveDuration,
  createInitialAvatarPlannerState,
  hasBlockingNonTtsPresentationWork,
  planAvatar,
} from "./planner";
export type {
  AvatarPlannerAction,
  AvatarPlannerDebugSnapshot,
  AvatarPlannerEmotionEvent,
  AvatarPlannerEmotionPostureConfig,
  AvatarPlannerEmotionReactionEvent,
  AvatarPlannerEnterPolicy,
  AvatarPlannerEvent,
  AvatarPlannerExitPolicy,
  AvatarPlannerGestureEvent,
  AvatarPlannerGestureResolutionSource,
  AvatarPlannerIdleStintDebugSnapshot,
  AvatarPlannerIdleStintPhase,
  AvatarPlannerIdleStintState,
  AvatarPlannerInput,
  AvatarPlannerLane,
  AvatarPlannerOutput,
  AvatarPlannerPendingEventDebugSnapshot,
  AvatarPlannerPoseClip,
  AvatarPlannerPoseClipSource,
  AvatarPlannerPoseClipStatus,
  AvatarPlannerProceduralPolicy,
  AvatarPlannerProceduralStint,
  AvatarPlannerReactionClip,
  AvatarPlannerReactionClipAction,
  AvatarPlannerResolvedGestureDebugSnapshot,
  AvatarPlannerRunStartedEvent,
  AvatarPlannerState,
  AvatarPlannerTalkingMotionArbitration,
  AvatarPlannerTalkingMotionSource,
  AvatarPlannerVrma,
  AvatarPlannerVrmaDebugSnapshot,
} from "./planner";
export {
  THINKING_HAND_ON_CHIN_HOLD_CLIP_ID,
  THINKING_HEAD_SCRATCH_CLIP_ID,
  THINKING_POSE_MIN_INPUT_LENGTH,
  getThinkingPoseClipChance,
  selectThinkingPoseClip,
  selectThinkingPoseClipId,
} from "./thinkingPoseSelection";
export type {
  SelectThinkingPoseClipOptions,
  ThinkingPoseClipSelection,
} from "./thinkingPoseSelection";
export type {
  EmotionGroup,
  EmotionIntensity,
  EmotionStateMap,
  EmotionValue,
  EmotionGroupSummary,
  RankedEmotion,
  ResolvedEmotionGroup,
  TrackedEmotion,
  VoiceEmotionKey,
} from "@/lib/emotion";

export async function preloadVrma(url: string): Promise<void> {
  await Avatar.preloadVrma(url);
}

export function clearVrmaCache(): void {
  Avatar.clearVrmaCache();
}

// Types
export type {
  BounceProceduralAnimationParams,
  BreathingProceduralAnimationParams,
  CursorLookAtInputProvider,
  CursorLookAtInputSnapshot,
  CursorLookAtProceduralAnimationParams,
  EmotionPostureDebugSnapshot,
  EmotionPostureGroup,
  EmotionPostureLevel,
  EmotionPostureLevelIntensities,
  EmotionPosturePresetMap,
  EmotionPosturePresetParams,
  EmotionPostureProceduralAnimationParams,
  EmotionPostureResolutionReason,
  EmotionPostureTarget,
  HeadNodProceduralAnimationParams,
  HeadSideTiltProceduralAnimationParams,
  PlannerProceduralPolicyAction,
  PlannerProceduralPolicySnapshot,
  ProceduralAnimationLayerId,
  ProceduralAnimationLayerParamsById,
  ProceduralAnimationLayerSnapshot,
  ProceduralAnimationRuntimeContext,
  ProceduralAnimationSnapshot,
  ProceduralSpeechTimingContext,
  SwayProceduralAnimationParams,
  TalkingHandsMicroTwistMode,
  TalkingHandsPlayGroupRequest,
  TalkingHandsProceduralAnimationParams,
  TalkingHandsSecondaryMicroTwistAxis,
} from "./ProceduralAnimationController";
export {
  DEFAULT_BOUNCE_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_BREATHING_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_CURSOR_LOOK_AT_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_EMOTION_POSTURE_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_HEAD_NOD_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_HEAD_SIDE_TILT_PROCEDURAL_ANIMATION_PARAMS,
  SUPPORTED_EMOTION_POSTURE_GROUPS,
  DEFAULT_SWAY_PROCEDURAL_ANIMATION_PARAMS,
  DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS,
  isEmotionPostureGroup,
} from "./ProceduralAnimationController";
export type {
  SpringBonePhysicsControllerOptions,
  SpringBonePhysicsParams,
  SpringBonePhysicsRuntimeContext,
  SpringBonePhysicsSnapshot,
  SpringBoneSemanticAssignmentSnapshot,
  SpringBoneSemanticProfileSnapshot,
} from "./spring-bone/SpringBonePhysicsController";
export { DEFAULT_SPRING_BONE_PHYSICS_PARAMS } from "./spring-bone/SpringBonePhysicsController";
export type {
  SpringBoneSemantic,
  SpringBoneSemanticProfile,
  SpringBoneSemanticProfileOverride,
} from "./spring-bone/SpringBoneSemanticProfile";
export type {
  SpringBoneSemanticAssignment,
  SpringBoneSemanticAssignmentSource,
  SpringBoneSemanticClassification,
  SpringBoneSemanticClassifierInput,
  SpringBoneSemanticJointCounts,
} from "./spring-bone/SpringBoneSemanticClassifier";
export type {
  AvatarPoseBoneSnapshot,
  AvatarPoseClipSnapshot,
  AvatarPoseSnapshot,
} from "./poses/types";
export type {
  AvatarLoadSpec,
  AvatarLoadPhase,
  AvatarLoadProgress,
  AvatarProgressCallback,
  AnimationOptions,
  AnimationLoopType,
  AnimationBlendMode,
  ActiveAnimationInfo,
  SegmentMeta,
  FramePayload,
  InternalFrame,
  SegmentTimeline,
  EmotionalState,
  ActiveEmotion,
  EmotionLabel,
  AvatarAnimationState,
  AvatarThinkingPoseClipId,
  AvatarAnimationSignals,
  AvatarStateSnapshot,
  ARKitBlendshapeName,
  VRMExpressionPresetName,
} from "./types";
export type {
  AvatarFaceBoxCoordinate,
  AvatarFaceEyeLandmarkSnapshot,
  AvatarFaceLandmarkBounds,
  AvatarFaceLandmarksSnapshot,
  AvatarFaceLandmarkVector,
} from "./vfx/landmark-types";
export type {
  AvatarFaceTextureAnchorSnapshot,
  AvatarFaceTextureAnchorsSnapshot,
  AvatarFaceTextureAnchorSource,
  AvatarFaceTextureFlattenRegion,
  AvatarFaceTextureFlattenRegionSnapshot,
  AvatarFaceTextureReferenceSize,
  AvatarFaceTextureUvCoordinate,
} from "./vfx/texture-anchor-types";
export type {
  AvatarVFXAnimationConfig,
  AvatarVFXAnimationPreset,
  AvatarVFXKind,
  AvatarVFXRotationDirection,
  AvatarVFXRegion,
  AvatarVFXResolvedAnimationConfig,
  AvatarVFXSoundConfig,
  AvatarVFXAppliedEffectSnapshot,
  AvatarVFXApplyMode,
  AvatarVFXAssetShape,
  AvatarBoxHoverVFXEntry,
  AvatarVFXCatalogEntry,
  AvatarVFXFaceFlattenSnapshot,
  AvatarVFXFlattenColorSnapshot,
  AvatarEyeHoverVFXEntry,
  AvatarMouthHoverVFXEntry,
  AvatarFaceAnchoredMouthVFXEntry,
  AvatarFaceAnchoredSingleDecalVFXEntry,
  AvatarFaceAnchoredSpanDecalVFXEntry,
  AvatarFaceAnchoredVFXEntry,
  AvatarVFXHoverPlacement,
  AvatarVFXHoverKind,
  AvatarHoverVFXEntry,
  AvatarVFXModelProfile,
  AvatarVFXNormalizedRect,
  AvatarVFXRenderMode,
  AvatarVFXSide,
  AvatarVFXSnapshot,
  AvatarVFXTargetBindingSnapshot,
  AvatarVFXTargetBindingTextureSlot,
  AvatarVFXTargetRole,
  AvatarTextureVFXEntry,
  AvatarVFXTextureAnchor,
  AvatarVFXTextureLayout,
  AvatarVFXTexturePivot,
  AvatarVFXTransform,
  AvatarVFXTransformAxisTriple,
  AvatarVFXTextureSlot,
} from "./vfx/types";
export type {
  VRMDocumentSourceInput,
  VRMEditorSessionInput,
  VRMEditorSessionSnapshot,
  VRMEditorSessionStatus,
  VRMInspectionAssetSummary,
  VRMInspectionBone,
  VRMInspectionMaterial,
  VRMInspectionMaterialTextureSlot,
  VRMInspectionMesh,
  VRMInspectionNode,
  VRMInspectionPrimitiveUsage,
  VRMInspectionSkin,
  VRMInspectionSnapshot,
  VRMInspectionSourceMode,
  VRMInspectionSourceSummary,
  VRMInspectionTexture,
  VRMInspectionTextureUsage,
  VRMRuntimePrimitiveBinding,
  VRMSpecVersion,
  VRMTextureUsageSource,
} from "./vrm-editor-types";

// Constants
export {
  BLINK_CLOSE_MAX,
  BLINK_OPEN_MAX,
  TRANSITION_BLEND_WINDOW_SEC,
  IDLE_DECAY_WINDOW_SEC,
  EPS,
} from "./types";
