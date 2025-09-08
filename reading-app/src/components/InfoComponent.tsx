import type { ParagraphViewModel } from "../analysis/viewModels/mapParagraphToVM";
import type { SentenceViewModel } from "../analysis/viewModels/mapSentenceToVM";


interface InfoProps<T> {
    info: T;
}

export const SentenceCardComponent = (props: InfoProps<SentenceViewModel>) => {
    const className = "sentence-info-card";
    
    return (
        <div className={className}>
            
        </div>
    )
}  

export const ParagraphCardComponent = (props: InfoProps<ParagraphViewModel>) => {
    const className = "paragraph-info-card";
    return (
        <div className={className}>

        </div>
    )
}