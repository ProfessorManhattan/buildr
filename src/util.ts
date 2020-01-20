import * as fs from 'fs';
import { isEqual, isObject, transform } from 'lodash';

/**
 * Recursively creates a directory
 *
 * @param path The path of the directory tree you want to create
 * @returns A promise that resolves when the operation is complete
 */
export function createDir(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdir(path, { recursive: true }, error => {
      if (error) {
        reject('Failed to create directory ' + path);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Compares two objects
 *
 * @param base The base object
 * @param obj The object you want to find the missing key/values of
 * @returns An object with the key/values that the obj is missing to be of base type
 */
export function diffObjects(base: {}, obj: {}): {} {
  return transform(obj, (result, value, key) => {
    if (!isEqual(value, base[key])) {
      if (!base[key]) {
        result[key] = isObject(value) && isObject(base[key]) ? diffObjects(value, base[key]) : value;
      }
    }
  });
}

/**
 * Return an array of files in a directory
 *
 * @param path The path to scan for files
 * @returns A promise that resolves an array of files
 */
export function dirFiles(path: string): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    fs.readdir(path, (error, files) => {
      if (error) {
        reject('Failed to acquire file listing in ' + path);
      } else {
        resolve(files);
      }
    });
  });
}

/**
 * Saves a file
 *
 * @param path The absolute path to the file
 * @param data The data being written to the file
 * @returns A promise that resolves if the file was written without error
 */
export function writeFile(path: string, data: any): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.writeFile(path, data, error => {
      if (error) {
        reject('Failed to save ' + path);
      } else {
        resolve();
      }
    });
  });
}
