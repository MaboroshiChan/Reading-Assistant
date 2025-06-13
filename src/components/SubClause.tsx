import type { SubClause as SubClauseType } from "../analysis/structure/Token";

interface SubClauseProps {
  subClause: SubClauseType;
}

export const SubClause: React.FC<SubClauseProps> = ({ subClause }) => {
  return (
    <div className="sub-clause" data-function={subClause.function} data-mood={subClause.mood}>
      {subClause.tokens.map((token, idx) => (
        <span key={idx} className="token">
          {token.text}
        </span>
      ))}
    </div>
  );
};