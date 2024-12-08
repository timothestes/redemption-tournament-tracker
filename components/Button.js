// components/Button.js
import React from 'react';
import styles from './common.module.css';
import classNames from 'classnames';

const Button = ({ children, variant = 'primary', ...props }) => {
  const buttonClass = classNames(styles.button, {
    [styles.secondary]: variant === 'secondary',
  });

  return (
    <button className={buttonClass} {...props}>
      {children}
    </button>
  );
};

export default Button;
