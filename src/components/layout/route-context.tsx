"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Labels for the fixed route segments the platform owns. Tenant identifiers are
 * resolved at runtime through {@link RegisterRouteLabel} so the chrome shows the
 * organization the reader actually opened instead of a hardcoded location.
 */
const segmentLabels: Readonly<Record<string, string>> = {
  overview: "Overview",
  opportunities: "Opportunities",
  agents: "Agents",
  campaigns: "Campaigns",
  executions: "Executions",
  organizations: "Organizations",
  settings: "Settings",
  new: "New organization",
  onboarding: "Guided onboarding",
  "digital-twin": "Digital Twin",
  integrations: "Integrations",
};

export type RouteCrumb = {
  label: string;
  href?: string;
  current: boolean;
};

function labelForSegment(segment: string, labels: Readonly<Record<string, string>>): string {
  if (labels[segment]) return labels[segment];
  if (uuidPattern.test(segment)) return "Organization";
  return (
    segmentLabels[segment] ??
    segment.replace(/-/g, " ").replace(/^./, (character) => character.toUpperCase())
  );
}

/**
 * Builds the breadcrumb trail from the live pathname. The `organizations`
 * segment is folded into the organization crumb so the trail reads
 * "Fixture Bakery / Integrations" rather than repeating the collection name.
 */
export function deriveRouteCrumbs(
  pathname: string,
  labels: Readonly<Record<string, string>> = {},
): RouteCrumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return [{ label: segmentLabels.overview, href: "/overview", current: true }];
  }

  const crumbs: RouteCrumb[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment === "organizations" && uuidPattern.test(segments[index + 1] ?? "")) continue;
    const isOrganization = uuidPattern.test(segment);
    crumbs.push({
      label: labelForSegment(segment, labels),
      // Only link to routes that exist: the Digital Twin page is the
      // organization's landing surface.
      href: isOrganization ? `/organizations/${segment}/digital-twin` : undefined,
      current: false,
    });
  }
  const last = crumbs.at(-1);
  if (last) {
    last.current = true;
    last.href = undefined;
  }
  return crumbs;
}

type RouteLabelContextValue = {
  labels: Readonly<Record<string, string>>;
  registerLabel: (segment: string, label: string) => void;
};

const RouteLabelContext = createContext<RouteLabelContextValue | null>(null);

export function RouteContextProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [labels, setLabels] = useState<Readonly<Record<string, string>>>({});
  const registerLabel = useCallback((segment: string, label: string) => {
    setLabels((current) =>
      current[segment] === label ? current : { ...current, [segment]: label },
    );
  }, []);
  const value = useMemo(() => ({ labels, registerLabel }), [labels, registerLabel]);

  return <RouteLabelContext.Provider value={value}>{children}</RouteLabelContext.Provider>;
}

/**
 * Lets an authenticated page name a tenant segment for the shared chrome. It
 * renders nothing and is a no-op outside the provider so pages stay portable.
 */
export function RegisterRouteLabel({
  segment,
  label,
}: Readonly<{ segment: string; label: string }>) {
  const context = useContext(RouteLabelContext);
  const registerLabel = context?.registerLabel;

  useEffect(() => {
    registerLabel?.(segment, label);
  }, [registerLabel, segment, label]);

  return null;
}

export function useRouteCrumbs(labels?: Readonly<Record<string, string>>): RouteCrumb[] {
  const pathname = usePathname() ?? "/";
  const context = useContext(RouteLabelContext);
  const contextLabels = context?.labels;
  return useMemo(
    () => deriveRouteCrumbs(pathname, labels ?? contextLabels ?? {}),
    [pathname, labels, contextLabels],
  );
}

export function RouteBreadcrumb({ labels }: Readonly<{ labels?: Record<string, string> }>) {
  const crumbs = useRouteCrumbs(labels);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${index}`}>
            <BreadcrumbItem className="min-w-0">
              {crumb.current ? (
                <BreadcrumbPage className="truncate font-medium">{crumb.label}</BreadcrumbPage>
              ) : crumb.href ? (
                <BreadcrumbLink asChild className="truncate">
                  <Link href={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <span className="truncate">{crumb.label}</span>
              )}
            </BreadcrumbItem>
            {crumb.current ? null : <BreadcrumbSeparator />}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
