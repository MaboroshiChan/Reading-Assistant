import React from 'react';
import './css/Tag.css';

export interface TagProps {
    name: string;
    type: 'logic' | 'concept';
    description?: string;
}

export const Tag: React.FC<TagProps> = ({ name, type, description }) => {
    return (
        <span 
            className={`custom-tag tag-${type}`} 
            title={description}
        >
            {name}
        </span>
    );
};
