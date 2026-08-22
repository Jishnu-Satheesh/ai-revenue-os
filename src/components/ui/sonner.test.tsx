import { describe, expect, it, vi } from "vitest";

vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light" }) }));

import { Toaster } from "@/components/ui/sonner";

describe("Toaster", () => {
  it("assigns distinct visual classes to success, error, and informational toasts", () => {
    const element = Toaster({}) as unknown as {
      props: { toastOptions?: { classNames?: Record<string, string> } };
    };

    expect(element.props.toastOptions?.classNames).toMatchObject({
      success: "cn-toast-success",
      error: "cn-toast-error",
      info: "cn-toast-info",
    });
  });
});
