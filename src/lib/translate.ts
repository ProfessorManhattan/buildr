import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../log';
import { createDir, diffObjects, dirFiles, writeFile } from '../util';

/* tslint:disable */
/**
 * Details on Translate found here:
 * [@google-cloud/translate](https://www.npmjs.com/package/@google-cloud/translate)
 */
const { Translate } = require('@google-cloud/translate').v2;
/* tslint:enable */

const log = new Logger();
const MISSING_TRANSLATION = '***MISSING TRANSLATION***';

/**
 * An object with both the reference path (either a folder or .json file) and an
 * optional path to markdown files to inject.
 */
export interface TranslateReference {
  /** Absolute path to the base translation - either a folder titled en or file titled en.json */
  readonly path: string;
  /**
   * The path to markdown files that are to be compiled and injected into the i18n files
   * in the path above Name the files KEY.SUBKEY.LANGUAGE.md
   *
   * Example:
   * ```
   * SettingsPage.Title.en.md
   * ```
   */

  readonly inject?: string;
}

export interface TranslateServiceConfig {
  /** Optionally pass languages to initialize */
  readonly languages?: string[];
  /** Max length to translate - will inject [[MISSING_TRANSLATION]] if over max length */
  readonly maxLength: number;
  /** The Google Translate projectId */
  readonly projectId: string;
  /** Details about the reference files to translate from */
  readonly reference: TranslateReference[];
  /** Whether or not to force all translations to re-retranslate */
  readonly retranslate: boolean;
  /** Absolute path to the folder that holds all the i18n content */
  readonly root: string;
}

interface FileDetails {
  readonly lang: string;
  readonly path: string;
}

/**
 * Uses [@google-cloud/translate](https://www.npmjs.com/package/@google-cloud/translate)
 * to scan an i18n folder and inject translations that are missing when compared to
 * the base translation.
 *
 * Use the service by passing the [[TranslateServiceConfig]] to a new instance of TranslateService
 * like this:
 * ```
 * const taintedTranslate = new TranslateService(translateServiceConfig);
 * taintedTranslate.run();
 * ```
 */
export class TranslateService {
  private readonly config: TranslateServiceConfig;
  private readonly googleTranslate: any;

  constructor(config: TranslateServiceConfig) {
    this.config = config;
    this.googleTranslate = new Translate({ projectId: config.projectId });
  }

  /**
   * Runs the translation routine using the configuration passed into the constructor
   */
  public async run(): Promise<void> {
    await Promise.all(this.config.reference.map(x => this.runReference(x)));
  }

  /**
   * This first acquires an array of all the file paths and corresponding languages. Then
   * it creates folders/empty files for any targets that do not already have data. And then
   * it acquires the missing translations.
   *
   * @param reference The [[TranslateReference]]
   * @returns A promise that resolves when the translation process is complete
   */
  private async runReference(reference: TranslateReference): Promise<void> {
    const isDir = fs.existsSync(reference.path) && fs.lstatSync(reference.path).isDirectory();
    const files = isDir ? await this.getDirectoryFiles(reference) : await this.getJSONFiles(reference);
    const baseFiles = files.result.filter(x => x.lang === files.referenceLanguage);
    const languages = this.config.languages ? this.config.languages : [...new Set(files.result.map(x => x.lang))];
    if (isDir) {
      // initialize empty folders if it is a directory type configuration
      await this.createEmptyFolders(reference);
    }
    // Initialize empty files for missing translations
    await Promise.all(baseFiles.map(x => this.createEmptyFiles(reference, x, isDir)));
    await Promise.all(baseFiles.map(x => this.acquireMissingTranslations(x, languages, isDir)));
  }

  /**
   * This creates empty files for any targets that do not exist
   *
   * @param baseFile Details on the es.json|fr.json or file in the translatable directory
   * @param isDir True if the translation routine type is a directory translation
   * @returns A promise that resolves when all the empty files are created
   */
  private async createEmptyFiles(reference: TranslateReference, baseFile: FileDetails, isDir: boolean): Promise<void> {
    await Promise.all(
      this.config.languages.map(language => {
        const fileToCheck = isDir
          ? path.dirname(reference.path) + '/' + language + '/' + path.basename(baseFile.path)
          : path.dirname(reference.path) + '/' + language + '.json';
        return !fs.existsSync(fileToCheck) ? writeFile(fileToCheck, '{}') : null;
      })
    );
  }
  /**
   * If the reference type is a directory, then this will create empty folders for any
   * of the (optional) languages passed in.
   *
   * @param reference The [[TranslateReference]]
   * @returns A promise that resolves when all the folders have been created
   */
  private async createEmptyFolders(reference: TranslateReference): Promise<void> {
    await Promise.all(
      this.config.languages.map(language => {
        const folder = path.dirname(reference.path) + '/' + language;
        return !fs.existsSync(folder) ? createDir(folder) : null;
      })
    );
  }

  /**
   * This assumes the directory name is a language code (e.g. "en"). It then scans through all of the different
   * folders that are named language codes and returns an array containg objects with both
   * the language and the path.
   *
   * @param reference The [[TranslateReference]]
   * @returns A promise that resolves with an array of objects containing the language and path of each
   * i18n file.
   */
  private async getDirectoryFiles(
    reference: TranslateReference
  ): Promise<{
    readonly result: readonly FileDetails[];
    readonly referenceLanguage: string;
  }> {
    const directories = await dirFiles(path.dirname(reference.path));
    const files = await Promise.all(directories.map(x => dirFiles(x)));
    const result = (directories as any)
      .map((pathh, index) =>
        files[index].map(file => ({
          lang: path.dirname(pathh),
          path: file
        }))
      )
      .flat();
    return { result, referenceLanguage: path.basename(reference.path) };
  }

  /**
   * This assumes that the target file is named "en.json", for instance. It then acquires all
   * the other files in the same folder and assumes they are also named {{LanguageCode}}.json.
   *
   * @param reference The [[TranslateReference]]
   * @returns A promise that resolves when the translation process is complete
   */
  private async getJSONFiles(
    reference: TranslateReference
  ): Promise<{
    readonly result: readonly FileDetails[];
    readonly referenceLanguage: string;
  }> {
    const referenceLanguage = path.basename(reference.path).replace('.json', '');
    const files = await dirFiles(path.dirname(reference.path));
    const result = files.map(x => ({
      lang: path.basename(x).replace('.json', ''),
      path: x
    }));
    return { result, referenceLanguage };
  }

  /**
   * Compares each of the i18n files to the reference language file and then uses Google
   * Translate to inject missing translations.
   *
   * @param baseFile The [[FileDetails]] of the reference file
   * @param files An array of languages to translate the file to
   * @param isDir Whether or not it is a directory of translations
   * @returns A promise that resolves when the translation process is complete for a given baseFile
   */
  private async acquireMissingTranslations(
    baseFile: FileDetails,
    languages: readonly string[],
    isDir: boolean
  ): Promise<void> {
    try {
      const base: {} = require(baseFile.path);
      const translations = languages.map(x => ({
        lang: x,
        output: {},
        path: isDir
          ? path.dirname(path.dirname(baseFile.path)) + '/' + x + '/' + path.basename(baseFile.path)
          : path.dirname(baseFile.path) + '/' + x + '.json'
      }));
      await Promise.all(
        translations.map(async translation => {
          const lang = translation.lang;
          const pathh = translation.path;
          // Load the translations
          const original = require(pathh);
          const updates = await this.getTranslations(diffObjects(base, original), lang);
          await writeFile(pathh, JSON.stringify({ ...updates.results, ...original }));
        })
      );
    } catch (e) {
      log.error('Failed to acquire missing translations', e);
    }
  }

  /**
   * A recursive function that crawls through an i18n file and adds missing translations
   * to the file as well as an indicator of whether or not any translations took place.
   *
   * @param obj An object with the current state of the i18n file being translated
   * @param lang The two character language string
   * @returns An object containing the translated i18n file as well as an indicator of
   * whether or any translations took place
   */
  private async getTranslations(
    obj: any,
    lang: string
  ): Promise<{ readonly results: {}; readonly translated: boolean }> {
    const results = {};
    for (const key of Object.keys(obj)) {
      const item = obj[key];
      if (typeof item === 'string') {
        // String to be translated
        if (item.length > this.config.maxLength) {
          return {
            results: { ...results, [key]: MISSING_TRANSLATION },
            translated: this.config.retranslate
          };
        } else {
          log.info('Translating "' + item + '" to ' + lang);
          const [translation] = await this.googleTranslate.translate(item, lang);
          return {
            results: { ...results, [key]: translation },
            translated: true
          };
        }
      } else {
        // Is a nested object
        const val = await this.getTranslations(item, lang);
        return {
          results: { ...results, [key]: val.translated },
          translated: val.translated
        };
      }
    }
    // Will never get here
    return null;
  }
}
