// components/spinner.js
import React from 'react';
import styles from './spinner.module.css';

const spinner = () => {
  return <div className={styles.spinner} role="status" aria-label="Loading"></div>;
};

export default spinner;
