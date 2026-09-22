import type { TransformControlsProps } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { forwardRef, useEffect, useLayoutEffect, useMemo } from "react";
import type { EventDispatcher, Object3D } from "three";
import { TransformControls } from "three-stdlib";

type AvatarTransformControlsProps = Pick<
  TransformControlsProps,
  | "domElement"
  | "enabled"
  | "mode"
  | "space"
  | "size"
  | "showX"
  | "showY"
  | "showZ"
  | "onChange"
  | "onMouseDown"
  | "onMouseUp"
  | "onObjectChange"
> & { object: Object3D };

/**
 * Own the control's DOM connection separately from construction. Drei's wrapper
 * connects during render and only detaches on unmount, retaining document
 * listeners even for renders that StrictMode discards before any effect runs.
 */
export const AvatarTransformControls = forwardRef<
  TransformControls,
  AvatarTransformControlsProps
>(function AvatarTransformControls(
  {
    domElement,
    object,
    onChange,
    onMouseDown,
    onMouseUp,
    onObjectChange,
    ...props
  },
  ref,
) {
  const camera = useThree((state) => state.camera);
  const connectedElement = useThree(
    (state) => state.events.connected || state.gl.domElement,
  );
  const defaultControls = useThree((state) => state.controls);
  const invalidate = useThree((state) => state.invalidate);
  const element = domElement ?? connectedElement;
  // Changing the camera or input surface starts a fresh interaction session.
  const connection = useMemo(
    () => ({ controls: new TransformControls(camera, undefined), element }),
    [camera, element],
  );
  const { controls } = connection;
  // three-stdlib's declaration inherits only Object3D's event map, omitting its
  // documented control events. Keep the compatibility cast at this boundary.
  const events = controls as unknown as EventDispatcher<
    Record<string, { value?: boolean }>
  >;

  useEffect(() => {
    controls.connect(connection.element);
    return () => controls.dispose();
  }, [connection, controls]);

  useLayoutEffect(() => {
    controls.attach(object);
    return () => void controls.detach();
  }, [controls, object]);

  useEffect(() => {
    if (
      !defaultControls ||
      !("enabled" in defaultControls) ||
      typeof defaultControls.enabled !== "boolean"
    )
      return;
    const orbit = defaultControls as { enabled: boolean };
    let enabledBeforeDrag: boolean | undefined;
    const restore = () => {
      if (enabledBeforeDrag !== undefined) {
        orbit.enabled = enabledBeforeDrag;
        enabledBeforeDrag = undefined;
      }
    };
    const onDraggingChanged = ({ value }: { value?: boolean }) => {
      if (value) {
        enabledBeforeDrag ??= orbit.enabled;
        orbit.enabled = false;
      } else {
        restore();
      }
    };
    events.addEventListener("dragging-changed", onDraggingChanged);
    return () => {
      events.removeEventListener("dragging-changed", onDraggingChanged);
      restore();
    };
  }, [defaultControls, events]);

  useEffect(() => {
    const change: NonNullable<typeof onChange> = (event) => {
      invalidate();
      onChange?.(event);
    };
    const mouseDown: NonNullable<typeof onMouseDown> = (event) =>
      onMouseDown?.(event);
    const mouseUp: NonNullable<typeof onMouseUp> = (event) =>
      onMouseUp?.(event);
    const objectChange: NonNullable<typeof onObjectChange> = (event) =>
      onObjectChange?.(event);
    events.addEventListener("change", change);
    events.addEventListener("mouseDown", mouseDown);
    events.addEventListener("mouseUp", mouseUp);
    events.addEventListener("objectChange", objectChange);
    return () => {
      events.removeEventListener("change", change);
      events.removeEventListener("mouseDown", mouseDown);
      events.removeEventListener("mouseUp", mouseUp);
      events.removeEventListener("objectChange", objectChange);
    };
  }, [events, invalidate, onChange, onMouseDown, onMouseUp, onObjectChange]);

  return <primitive ref={ref} object={controls} {...props} />;
});
