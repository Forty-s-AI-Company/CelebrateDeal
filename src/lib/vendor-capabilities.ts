export function canManageCommerceProducts(role: string | null | undefined) {
  return role === "owner" || role === "admin";
}

export const canManageCourses = canManageCommerceProducts;
export const canViewCourseEnrollmentPii = canManageCommerceProducts;
export const canManageMessageDelivery = canManageCommerceProducts;

export function canManageLiveRooms(role: string | null | undefined) {
  return role === "owner" || role === "admin" || role === "staff";
}

export const canManageVideos = canManageLiveRooms;
