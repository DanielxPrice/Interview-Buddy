
import React, { useState } from "react";

export const DEFAULT_PROFILE_BADGE =
  "/Cheerful%20Graduate%20Mascot%20Badge.png";

function ProfileBadge({
  imageSrc = DEFAULT_PROFILE_BADGE,
  badgeAlt = "Cheerful graduate mascot badge",
  username = "User",
}) {
  const [failedSrc, setFailedSrc] = useState(null);

  const imageFailed = failedSrc === imageSrc;

  return (
    <div
      className="sidebarProfileBadge"
      title={`${username}'s profile badge`}
    >
      {!imageFailed ? (
        <img
          src={imageSrc}
          alt={badgeAlt}
          className="sidebarProfileBadgeImage"
          onError={() => setFailedSrc(imageSrc)}
        />
      ) : (
        <span
          className="sidebarProfileBadgeFallback"
          aria-label={`${username}'s profile`}
          role="img"
        >
          {username.slice(0, 2).toUpperCase()}
        </span>
      )}
    </div>
  );
}

export default ProfileBadge;
