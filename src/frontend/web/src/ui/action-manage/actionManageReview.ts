import type { PyLoadoutPlan } from "@/lib/content/catalogTypes";

export type ManageReview = {
  animaId: string;
  animaName: string;
  plan?: PyLoadoutPlan;
  error?: string;
};

export function canConfirmActionManage(reviews: ManageReview[]): boolean {
  return reviews.some(
    (review) => review.plan && review.plan.action !== "unchanged",
  );
}

export function manageableReviews(reviews: ManageReview[]): ManageReview[] {
  return reviews.filter(
    (review) => review.plan && review.plan.action !== "unchanged",
  );
}
