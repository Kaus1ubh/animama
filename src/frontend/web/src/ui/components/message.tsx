import {
  Message as ProductMessage,
  type MessageProps,
} from "@animama/product-ui/components";
import { useOptionalAppShell } from "@/ui/app/AppShell";
import {
  COLLAPSED_SIDEBAR_CONTROL_INSET,
  EXPANDED_SIDEBAR_WIDTH,
} from "@/ui/app/appShellSidebarLayout";
export { MessageContent, MessageAvatar } from "@animama/product-ui/components";
export type {
  MessageLayout,
  MessageProps,
  MessageContentProps,
  MessageAvatarProps,
} from "@animama/product-ui/components";
export function Message(props: MessageProps) {
  const shell = useOptionalAppShell();
  const inset = !shell?.isDesktop
    ? 0
    : props.from === "user"
      ? shell.sidebarOpen
        ? 200
        : 70
      : (shell.sidebarOpen
          ? EXPANDED_SIDEBAR_WIDTH
          : COLLAPSED_SIDEBAR_CONTROL_INSET) + 16;
  return <ProductMessage {...props} overlayInset={inset} />;
}
