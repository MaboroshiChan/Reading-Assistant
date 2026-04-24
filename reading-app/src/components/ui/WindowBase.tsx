import React, { useEffect, useState } from 'react';
import './css/WindowBase.css';

interface WindowBaseProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
}

export const WindowBase: React.FC<WindowBaseProps> = ({ isOpen, onClose, title, children }) => {
    const [shouldRender, setShouldRender] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setShouldRender(true);
        } else {
            // Wait for animation to finish before unmounting
            const timer = setTimeout(() => {
                setShouldRender(false);
            }, 300); // match css transition
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!shouldRender) return null;

    return (
        <div className={`window-backdrop ${isOpen ? 'open' : ''}`} onClick={onClose}>
            <div 
                className={`window-container ${isOpen ? 'open' : ''}`} 
                onClick={(e) => e.stopPropagation()}
            >
                <header className="window-header">
                    <h2 className="window-title">{title}</h2>
                    <button className="window-close-btn" onClick={onClose} aria-label="Close">
                        ×
                    </button>
                </header>
                <main className="window-content">
                    {children}
                </main>
            </div>
        </div>
    );
};
