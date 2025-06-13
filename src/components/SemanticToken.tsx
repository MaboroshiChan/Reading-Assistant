import type { Token } from "../analysis/structure/Token";
import { SubClause } from "./SubClause";
// import css
import React from "react";
import "./css/SemanticToken.css"; // Assuming you have a CSS file for styling

interface TokenProps {
  token: Token;
}

export const SemanticToken: React.FC<TokenProps> = ({ token }) => {
  const roleClass = token.role ? `role-${token.role.toLowerCase()}` : "";
  // Add spaces between tokens
  return (
    <span className={`token ${roleClass}`}>
      {token.text}
      {token.subClause && <SubClause subClause={token.subClause} />}
    </span>
  );
};